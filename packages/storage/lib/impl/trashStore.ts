import type { BookmarkNode, TrashInput, TrashItem } from '../types.js';

/** `chrome.storage.local` 上のキー名。`TrashItem[]` を丸ごと1配列として保存する。 */
const TRASH_KEY = 'trash';

/** ゴミ箱の件数上限（architecture.md「スケーラビリティ設計」の「例500件」）。超過分は古い順に削除する。 */
const MAX_TRASH_ITEMS = 500;

/**
 * ゴミ箱の容量上限（バイト）。`storage.local` の既定上限（約10MB）から逆算した枠。
 * `AliasStore.byteLength` と同じく `TextEncoder` で実バイト長を測る。
 */
const MAX_TRASH_BYTES = 4 * 1024 * 1024;

/**
 * `TrashStore.restore` が復元に使う `BookmarkService` の最小契約。
 *
 * `packages/storage` 内で `BookmarkService` を直接 import してもよいが（同一パッケージ内・循環にならない）、
 * `AliasStore` の DI 方針（構造的インターフェースで受け取り呼び出し側が注入する）にそろえ、
 * テストではモックを注入しやすくする。
 */
export interface TrashBookmarkGateway {
  /** フォルダパスを上から辿り、無い階層は自動作成して末端フォルダの ID を返す。 */
  ensureFolderPath(path: string[]): Promise<string>;
  /** ブックマーク/フォルダを作成する（`url` 未指定ならフォルダ）。 */
  create(data: { url?: string; title: string; parentId: string }): Promise<BookmarkNode>;
}

/**
 * `TrashStore.restore` が別名の復帰に使う `AliasStore` の最小契約。
 *
 * `AliasStore` は `Normalizer`（`packages/shared`）の注入が必須で `packages/storage` 内では
 * 生成できない（`storage → shared` を追加すると `shared ⇄ storage` の循環になるため。
 * `AliasStore` 自身の `AliasNormalizer` と同じ制約）。そのため実体は呼び出し側（`services.ts`）が注入する。
 */
export interface TrashAliasGateway {
  /** 別名を登録/更新する。 */
  upsert(url: string, aliases: string[]): Promise<void>;
}

/**
 * 削除データの永続化を担うデータレイヤー実装（U16・機能12「ゴミ箱」）。
 *
 * 即時アンドゥ（U10 `UndoManager`・5秒・メモリ）とは別の第2層防御。`chrome.storage.local` の
 * `trash` キーに `TrashItem[]` を丸ごと保存し、保持日数（既定30日）・件数上限（500件）・
 * 容量上限（4MB）を超えた分は古い順に自動的に取り除く（architecture.md「バックアップ戦略」）。
 */
export class TrashStore {
  /**
   * push/restore/remove/clear の書き込みを直列化するキュー。
   *
   * いずれも「配列全体を読む→メモリ上で変更→書き戻す」という非アトミックな read-modify-write を
   * 行う。一括削除（U13）のように連続呼び出しがあると、後勝ちの `set` が先の呼び出しの変更を
   * 丸ごと上書きしうる（`AliasStore.writeQueue` で実測済みの不具合と同種）。呼び出し側に直列呼び出しを
   * 強いる代わりに、データレイヤー側で保証する。
   */
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly bookmarks: TrashBookmarkGateway,
    private readonly aliases: TrashAliasGateway,
  ) {}

  private get area(): chrome.storage.StorageArea {
    return globalThis.chrome.storage.local;
  }

  /** ゴミ箱の一覧を削除日時の新しい順で返す。 */
  async list(): Promise<TrashItem[]> {
    const items = await this.loadItems();
    return [...items].sort((a, b) => b.deletedAt - a.deletedAt);
  }

  /**
   * 削除データを退避する。`id`（`crypto.randomUUID()`）・`deletedAt`（`Date.now()`）は
   * 本メソッドが子孫も含め再帰的に採番する。追加後、件数/容量上限を超えた分は自動的に取り除く。
   * 戻り値はゴミ箱内 ID（即時アンドゥで取り消す際に `remove(id)` へ渡す）。
   */
  async push(input: TrashInput): Promise<string> {
    const item = this.toTrashItem(input);
    await this.enqueueWrite(async () => {
      const items = await this.loadItems();
      items.push(item);
      const limited = this.applyLimits(items);
      await this.saveItems(limited);
    });
    return item.id;
  }

  /**
   * 元のフォルダパスへ復元する。無ければ `ensureFolderPath` で自動再作成する
   * （ID・作成日時は新規採番）。`kind: 'folder'` は配下ツリーごと再帰的に復元する。
   * 復元に成功した場合のみゴミ箱から取り除く。失敗時は例外を伝播し、項目はゴミ箱に残す
   * （データ損失ゼロを優先する。development-guidelines「エラーハンドリング」）。
   */
  async restore(id: string): Promise<void> {
    const items = await this.loadItems();
    const target = items.find(item => item.id === id);
    if (!target) {
      throw new Error(`TrashStore: 対象がゴミ箱に存在しません(id=${id})`);
    }

    const parentId = await this.bookmarks.ensureFolderPath(target.folderPath);
    await this.restoreInto(target, parentId);

    await this.enqueueWrite(async () => {
      const current = await this.loadItems();
      await this.saveItems(current.filter(item => item.id !== id));
    });
  }

  /** ゴミ箱から完全に削除する（復元せず捨てる。即時アンドゥで元に戻した際の取り消しにも使う）。 */
  async remove(id: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const items = await this.loadItems();
      await this.saveItems(items.filter(item => item.id !== id));
    });
  }

  /** ゴミ箱を空にする。 */
  async clear(): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.saveItems([]);
    });
  }

  /** 保持日数を過ぎた項目を削除する。戻り値は削除件数。 */
  async purgeExpired(retentionDays: number): Promise<number> {
    return this.enqueueWrite(async () => {
      const items = await this.loadItems();
      const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      const kept = items.filter(item => item.deletedAt >= threshold);
      const removedCount = items.length - kept.length;
      if (removedCount > 0) {
        await this.saveItems(kept);
      }
      return removedCount;
    });
  }

  /**
   * 件数上限（`MAX_TRASH_ITEMS`）・容量上限（`MAX_TRASH_BYTES`）を超えた分を古い順に削除する。
   * 戻り値は削除件数。`push` が内部で自動適用するため、通常は呼び出し側から明示的に呼ぶ必要はない。
   */
  async enforceLimits(maxItems = MAX_TRASH_ITEMS, maxBytes = MAX_TRASH_BYTES): Promise<number> {
    return this.enqueueWrite(async () => {
      const items = await this.loadItems();
      const limited = this.applyLimits(items, maxItems, maxBytes);
      const removedCount = items.length - limited.length;
      if (removedCount > 0) {
        await this.saveItems(limited);
      }
      return removedCount;
    });
  }

  /**
   * 直列化キューにタスクを追加する。前段のタスクが成功/失敗いずれで終わっても後続は実行する
   * （1件の失敗でキュー全体が詰まらないようにする。`AliasStore.enqueueWrite` と同じ設計）。
   */
  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async loadItems(): Promise<TrashItem[]> {
    const result = await this.area.get([TRASH_KEY]);
    return (result[TRASH_KEY] as TrashItem[] | undefined) ?? [];
  }

  private async saveItems(items: TrashItem[]): Promise<void> {
    await this.area.set({ [TRASH_KEY]: items });
  }

  /** 件数上限超過分、続いて容量上限超過分を `deletedAt` 昇順（古い順）に取り除く。 */
  private applyLimits(items: TrashItem[], maxItems = MAX_TRASH_ITEMS, maxBytes = MAX_TRASH_BYTES): TrashItem[] {
    const sorted = [...items].sort((a, b) => a.deletedAt - b.deletedAt);
    let result = sorted.length > maxItems ? sorted.slice(sorted.length - maxItems) : sorted;
    while (result.length > 0 && this.byteLength(result) > maxBytes) {
      result = result.slice(1);
    }
    return result;
  }

  private byteLength(items: TrashItem[]): number {
    return new TextEncoder().encode(JSON.stringify(items)).length;
  }

  /** `TrashInput` から `TrashItem` を再帰的に組み立てる（id/deletedAt を子孫にも採番する）。 */
  private toTrashItem(input: TrashInput): TrashItem {
    return {
      id: crypto.randomUUID(),
      kind: input.kind,
      url: input.url,
      title: input.title,
      folderPath: input.folderPath,
      aliases: input.aliases,
      children: input.children?.map(child => this.toTrashItem(child)),
      deletedAt: Date.now(),
    };
  }

  /** 復元対象1件を `parentId` の配下へ再帰的に作り直す。`kind: 'folder'` は子を先にフォルダ作成→再帰する。 */
  private async restoreInto(target: TrashItem, parentId: string): Promise<void> {
    if (target.kind === 'folder') {
      const folder = await this.bookmarks.create({ title: target.title, parentId });
      for (const child of target.children ?? []) {
        await this.restoreInto(child, folder.id);
      }
      return;
    }

    if (!target.url) {
      throw new Error(`TrashStore: kind='bookmark' に url がありません(id=${target.id})`);
    }
    await this.bookmarks.create({ url: target.url, title: target.title, parentId });
    if (target.aliases.length > 0) {
      await this.aliases.upsert(target.url, target.aliases);
    }
  }
}

export { MAX_TRASH_ITEMS, MAX_TRASH_BYTES };
