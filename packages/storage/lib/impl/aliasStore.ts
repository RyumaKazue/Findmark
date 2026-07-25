import type { AliasChunk, AliasIndex, AliasRecord } from '../types.js';

/** `chrome.storage` 上のキー名。`alias_chunk_0`, `alias_chunk_1`, ... と逆引き `alias_index`。 */
const ALIAS_INDEX_KEY = 'alias_index';
const aliasChunkKey = (chunkNo: number): string => `alias_chunk_${chunkNo}`;

/**
 * 1チャンクの安全バイト長閾値。`chrome.storage.sync` の 8KB/アイテム上限（キー名+JSON値のUTF-8バイト長）に
 * 対し、キー名分の余裕を見て 7KB に設定する。件数ではなく実バイト長で判定する（別名の多い/長いレコードでは
 * 100件でも超えうるため）。
 */
const CHUNK_BYTE_LIMIT = 7 * 1024;

const MAX_ALIASES = 20;
const MAX_ALIAS_LENGTH = 50;

const DEFAULT_INDEX: AliasIndex = { chunkCount: 0, hashToChunk: {}, storageMode: 'sync' };

type StorageMode = AliasIndex['storageMode'];

/**
 * `AliasStore` が別名比較・URL紐付けに必要とする正規化機能の最小契約。
 *
 * `packages/storage` は `packages/shared`（`Normalizer` の実体）に依存できない
 * （`storage → shared` を追加すると `shared ⇄ storage` の循環になり turbo のビルドが破綻する。
 * repository-structure.md「循環依存の禁止」参照）。そのため実体は呼び出し側（`packages/shared`）が
 * 注入する。`Normalizer` クラスはこのインターフェースを構造的に満たす。
 */
export interface AliasNormalizer {
  /** URL を正規化してハッシュ化する（紐付けキー生成）。不正な URL は呼び出し元の実装が TypeError を throw する。 */
  hashUrl(url: string): string;
  /** 別名比較用のテキスト正規化（NFKC・小文字化・カナ統一等）。 */
  normalizeText(input: string): string;
}

/** 別名の個数/文字数上限超過（予期されたエラー）。`kind` で UI 側が文言を出し分ける。 */
export class AliasLimitError extends Error {
  constructor(
    message: string,
    public readonly limit: number,
    public readonly kind: 'count' | 'length',
  ) {
    super(message);
    this.name = 'AliasLimitError';
  }
}

/**
 * 別名（`AliasRecord`）の永続化を担うデータレイヤー実装。
 *
 * `chrome.storage.sync` の「1アイテム8KB / 全体100KB」制限を回避するため、レコードをバイト長ベースで
 * チャンク（`alias_chunk_N`）に分割し、逆引きインデックス（`alias_index`）で対象チャンクのみを読み書きする。
 * sync の容量超過時は `chrome.storage.local` へ全データを退避し、以後は local を使用する
 * （同期の継続よりデータ損失ゼロを優先する）。
 */
export class AliasStore {
  /**
   * upsert/remove の書き込みを直列化するキュー。
   *
   * upsert/remove は「対象チャンクを読む→メモリ上で変更→書き戻す」という非アトミックな
   * read-modify-write を行う。並行呼び出し（例: `Promise.all` での一括インポート）があると、
   * 後勝ちの `set` が先の呼び出しの変更を丸ごと上書きし、データが完全に失われうる
   * （実測で確認済み）。呼び出し側に直列呼び出しを強いる代わりに、データレイヤー側で保証する。
   */
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly normalizer: AliasNormalizer) {}

  private get syncArea(): chrome.storage.StorageArea {
    return globalThis.chrome.storage.sync;
  }

  private get localArea(): chrome.storage.StorageArea {
    return globalThis.chrome.storage.local;
  }

  private area(mode: StorageMode): chrome.storage.StorageArea {
    return mode === 'sync' ? this.syncArea : this.localArea;
  }

  /** 指定 URL の別名レコードを取得する（無ければ `null`）。 */
  async getByUrl(url: string): Promise<AliasRecord | null> {
    const hash = this.normalizer.hashUrl(url);
    const index = await this.loadIndex();
    const chunkNo = index.hashToChunk[hash];
    if (chunkNo === undefined) {
      return null;
    }
    const chunk = await this.readChunk(index.storageMode, chunkNo);
    return chunk[hash] ?? null;
  }

  /** 全チャンクを結合し、`urlHash → AliasRecord` の全件マップを返す。 */
  async getAll(): Promise<Map<string, AliasRecord>> {
    const index = await this.loadIndex();
    const result = new Map<string, AliasRecord>();
    for (let chunkNo = 0; chunkNo < index.chunkCount; chunkNo++) {
      const chunk = await this.readChunk(index.storageMode, chunkNo);
      for (const [hash, record] of Object.entries(chunk)) {
        result.set(hash, record);
      }
    }
    return result;
  }

  /** 別名を登録/更新する（正規化・重複排除・上限検証を内包）。 */
  async upsert(url: string, aliases: string[]): Promise<void> {
    await this.upsertRecord(url, aliases);
  }

  /** インポート時の別名マージ。既存別名と `incoming` の和集合を `upsert` する。 */
  async merge(url: string, incoming: string[]): Promise<AliasRecord> {
    const existing = await this.getByUrl(url);
    const union = [...(existing?.aliases ?? []), ...incoming];
    return this.upsertRecord(url, union);
  }

  /** 指定 URL の別名レコードを削除する。 */
  async remove(url: string): Promise<void> {
    const hash = this.normalizer.hashUrl(url);
    await this.enqueueWrite(async () => {
      const index = await this.loadIndex();
      const chunkNo = index.hashToChunk[hash];
      if (chunkNo === undefined) {
        return;
      }

      const chunk = await this.readChunk(index.storageMode, chunkNo);
      delete chunk[hash];
      delete index.hashToChunk[hash];

      await this.area(index.storageMode).set({ [ALIAS_INDEX_KEY]: index, [aliasChunkKey(chunkNo)]: chunk });
    });
  }

  /** `upsert`/`merge` が共有する実処理。検証・ハッシュ計算は同期のためキュー外で即座に行い（早期失敗）、
   * 実際の read-modify-write のみをキューで直列化する。書き込んだレコードを返す。 */
  private async upsertRecord(url: string, aliases: string[]): Promise<AliasRecord> {
    const hash = this.normalizer.hashUrl(url);
    const deduped = this.validateAndDedup(aliases);
    const record: AliasRecord = { urlHash: hash, url, aliases: deduped, updatedAt: Date.now() };

    await this.enqueueWrite(async () => {
      const write = async (mode: StorageMode, index: AliasIndex): Promise<void> => {
        const chunkNo = await this.pickChunkFor(hash, record, index, mode);
        const chunk = await this.readChunk(mode, chunkNo);
        chunk[hash] = record;
        index.hashToChunk[hash] = chunkNo;
        index.chunkCount = Math.max(index.chunkCount, chunkNo + 1);
        await this.area(mode).set({ [ALIAS_INDEX_KEY]: index, [aliasChunkKey(chunkNo)]: chunk });
      };

      const index = await this.loadIndex();
      await this.withQuotaFailover(index, write);
    });

    return record;
  }

  /**
   * 直列化キューにタスクを追加する。前段のタスクが成功/失敗いずれで終わっても後続は実行する
   * （1件の失敗でキュー全体が詰まらないようにする）。返す promise は `task()` 自体の成否を反映する。
   */
  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** `alias_index` を sync→local の順で探索する。どちらにも無ければ既定値（sync・0チャンク）。 */
  private async loadIndex(): Promise<AliasIndex> {
    const syncResult = await this.syncArea.get([ALIAS_INDEX_KEY]);
    if (syncResult[ALIAS_INDEX_KEY]) {
      return syncResult[ALIAS_INDEX_KEY] as AliasIndex;
    }
    const localResult = await this.localArea.get([ALIAS_INDEX_KEY]);
    if (localResult[ALIAS_INDEX_KEY]) {
      return localResult[ALIAS_INDEX_KEY] as AliasIndex;
    }
    return { ...DEFAULT_INDEX, hashToChunk: {} };
  }

  private async readChunk(mode: StorageMode, chunkNo: number): Promise<AliasChunk> {
    const key = aliasChunkKey(chunkNo);
    const result = await this.area(mode).get([key]);
    return (result[key] as AliasChunk | undefined) ?? {};
  }

  private byteLength(chunk: AliasChunk): number {
    return new TextEncoder().encode(JSON.stringify(chunk)).length;
  }

  /**
   * 個数（最大20）・文字数（最大50）を検証し、正規化テキストで重複する別名を排除する（先勝ち）。
   * 上限は「重複排除後の件数」で判定する（生の入力件数ではない）。
   */
  private validateAndDedup(aliases: string[]): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const alias of aliases) {
      if (alias.length > MAX_ALIAS_LENGTH) {
        throw new AliasLimitError(`別名は1個あたり${MAX_ALIAS_LENGTH}文字までです`, MAX_ALIAS_LENGTH, 'length');
      }
      const key = this.normalizer.normalizeText(alias);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(alias);
    }
    if (deduped.length > MAX_ALIASES) {
      throw new AliasLimitError(`別名は1件あたり${MAX_ALIASES}個までです`, MAX_ALIASES, 'count');
    }
    return deduped;
  }

  /**
   * レコードの書き込み先チャンク番号を決める。
   * 既存の紐付け（`hashToChunk`）を最優先で維持する（1レコードが7KBを超えることは実質ないため、
   * 更新で既存チャンクが閾値をわずかに超えても移動しない）。新規の場合は追加後もバイト長が閾値内に
   * 収まる既存チャンクを探し、無ければ新しいチャンク番号を返す。
   */
  private async pickChunkFor(hash: string, record: AliasRecord, index: AliasIndex, mode: StorageMode): Promise<number> {
    const existing = index.hashToChunk[hash];
    if (existing !== undefined) {
      return existing;
    }

    for (let chunkNo = 0; chunkNo < index.chunkCount; chunkNo++) {
      const chunk = await this.readChunk(mode, chunkNo);
      const projectedSize = this.byteLength({ ...chunk, [hash]: record });
      if (projectedSize <= CHUNK_BYTE_LIMIT) {
        return chunkNo;
      }
    }
    return index.chunkCount;
  }

  /** `write` を実行し、sync の容量超過時のみ local へフォールバックして再実行する。 */
  private async withQuotaFailover(
    index: AliasIndex,
    write: (mode: StorageMode, index: AliasIndex) => Promise<void>,
  ): Promise<void> {
    try {
      await write(index.storageMode, index);
    } catch (e) {
      if (index.storageMode !== 'sync' || !this.isQuotaExceeded(e)) {
        // 回復不能な想定外エラー。握り潰さず上位へ伝播する前にログへ残す
        // （development-guidelines.md「エラーハンドリング」）。
        console.error('[AliasStore] 別名の保存に失敗しました（回復不能）:', e);
        throw e;
      }
      const localIndex = await this.failoverToLocal(index);
      await write('local', localIndex);
    }
  }

  private isQuotaExceeded(e: unknown): boolean {
    const message = e instanceof Error ? e.message : String(e);
    return /quota/i.test(message);
  }

  /** sync 上の index + 全チャンクを local へコピーし、sync 側を削除する。以後 local を使用する。 */
  private async failoverToLocal(index: AliasIndex): Promise<AliasIndex> {
    const chunks: AliasChunk[] = [];
    for (let chunkNo = 0; chunkNo < index.chunkCount; chunkNo++) {
      chunks.push(await this.readChunk('sync', chunkNo));
    }

    const localIndex: AliasIndex = {
      chunkCount: index.chunkCount,
      hashToChunk: { ...index.hashToChunk },
      storageMode: 'local',
    };

    const toWrite: Record<string, unknown> = { [ALIAS_INDEX_KEY]: localIndex };
    chunks.forEach((chunk, chunkNo) => {
      toWrite[aliasChunkKey(chunkNo)] = chunk;
    });
    // local.set が失敗した場合は例外がそのまま呼び出し元（withQuotaFailover）へ伝播する。
    // sync 側はまだ削除していないため sync のデータは温存されたままであり、次回呼び出しの
    // loadIndex() は改めて sync を読むため実害はない。
    await this.localArea.set(toWrite);

    const keysToRemove = [ALIAS_INDEX_KEY, ...chunks.map((_, chunkNo) => aliasChunkKey(chunkNo))];
    await this.syncArea.remove(keysToRemove);

    return localIndex;
  }
}
