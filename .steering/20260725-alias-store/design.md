# 設計書 — U5 alias-store

## アーキテクチャ概要

`AliasStore` は最下層データレイヤー（`packages/storage`）に属し、`chrome.storage.sync` / `chrome.storage.local` を直接扱う。ドメインロジック（Normalizer）は上位の `packages/shared` にあるが、**`storage → shared` の依存は循環禁止**（U4 で `shared ⇄ storage` の turbo ビルド破綻を経験済み）。そのため Normalizer を **依存注入（DI）** で受け取り、storage は shared を import しない。

```mermaid
graph TD
    subgraph pages["pages/* (UI・U9/U14)"]
      UI[AliasEditor / AddCurrentPanel]
    end
    subgraph shared["packages/shared (サービス)"]
      SE[SearchEngine U6]
      NM[Normalizer U3]
      WIRE[aliasStore シングルトン<br/>= new AliasStore(normalizer)]
    end
    subgraph storage["packages/storage (データ・本単位)"]
      AS[AliasStore クラス]
      ERR[AliasLimitError]
      IF[AliasNormalizer インターフェース]
    end
    UI --> WIRE
    SE --> WIRE
    WIRE --> AS
    WIRE --> NM
    AS -->|DI| IF
    AS --> SYNC[(chrome.storage.sync)]
    AS --> LOCAL[(chrome.storage.local)]
```

**合成点（composition）**: `AliasStore` は Normalizer を必要とするが storage は shared を import できないため、**配線済みシングルトン `aliasStore = new AliasStore(normalizer)` は `packages/shared` 側で生成・export** する（shared は storage と Normalizer の両方を参照でき、依存は `shared → storage` の一方向のまま）。storage は `AliasStore` クラス・`AliasLimitError`・`AliasNormalizer` インターフェースを export する。

## コンポーネント設計

### 1. `AliasNormalizer` インターフェース（storage 内で定義）

**責務**:
- storage が Normalizer 実体を import せずに正規化機能を受け取るための最小契約。
- `Normalizer`（shared）が構造的に満たす（`hashUrl` / `normalizeText`）。

```typescript
export interface AliasNormalizer {
  /** URL を正規化してハッシュ化（紐付けキー生成）。不正URLは TypeError を素通し。 */
  hashUrl(url: string): string;
  /** 別名の重複判定用テキスト正規化。 */
  normalizeText(input: string): string;
}
```

### 2. `AliasLimitError`（storage 内で定義・export）

**責務**:
- 別名の個数/文字数上限超過を型で表す予期されたエラー（`docs/development-guidelines.md` エラーハンドリング）。

```typescript
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
```

**実装の要点**:
- UI（U9）が `kind` で「20個まで」「50文字まで」を出し分けられるようにする。

### 3. `AliasStore` クラス（`packages/storage/lib/impl/aliasStore.ts`）

**責務**:
- `AliasRecord` の CRUD、チャンク分割/結合、sync↔local フォールバック。

**公開 API**（`docs/functional-design.md` の定義に一致）:
```typescript
class AliasStore {
  constructor(normalizer: AliasNormalizer);
  getByUrl(url: string): Promise<AliasRecord | null>;
  getAll(): Promise<Map<string, AliasRecord>>;
  upsert(url: string, aliases: string[]): Promise<void>;
  merge(url: string, incoming: string[]): Promise<AliasRecord>;
  remove(url: string): Promise<void>;
}
```

**private ヘルパ**:
- `loadIndex(): Promise<AliasIndex>` — sync に `alias_index` があれば sync モード、なければ local を確認、どちらも無ければ既定 `{ chunkCount: 0, hashToChunk: {}, storageMode: 'sync' }`。
- `area(mode): chrome.storage.StorageArea` — `storageMode` に応じ sync / local を返す（`globalThis.chrome.storage.*` を getter 経由で参照）。
- `readChunk(mode, no): Promise<AliasChunk>` / `writeIndexAndChunk(...)` — 対象チャンクと index の読み書き。
- `validateAndDedup(aliases): string[]` — 個数/文字数検証（`AliasLimitError`）＋ `normalizeText` による重複排除（原文字列は先勝ちで保持）。
- `pickChunkFor(record, index, mode)` — 既存 `hashToChunk[urlHash]` を優先、無ければ各チャンクへ追加試算して閾値内に収まる最初のチャンク、無ければ新規チャンク番号。
- `failoverToLocal(index): Promise<AliasIndex>` — sync 上の index+全チャンクを local へコピー → sync の `alias_*` キー削除 → `storageMode='local'` の index を返す。
- `withQuotaFailover(mode, writeFn)` — 書き込みを実行し、sync で容量超過を検知したら `failoverToLocal` して local へ再書き込み。

**実装の要点**:
- **バイト長計測**: `new TextEncoder().encode(JSON.stringify(chunk)).length` を用い、`CHUNK_BYTE_LIMIT = 7 * 1024`（7168）を閾値とする。キー名分の余裕を見た安全マージン。
- **チャンクキー**: `alias_chunk_${no}`、index キー `alias_index`（定数化）。
- **容量超過検知**: `chrome.storage.sync.set` の reject を捕捉し、`chrome.runtime.lastError` またはエラー message に `QUOTA` を含むか（大文字小文字無視）で判定する。判定に迷う場合も sync 書き込み失敗は local へ退避（データ損失ゼロ優先）。
- **既定書き込み先の一貫性**: 書き込みは常に「現在の `storageMode`」に従う。フォールバック後は index も local に置くため、次回 `loadIndex` は local を検出する。
- **remove の空チャンク**: 空になったチャンクはキー自体を残し `{}` を書く（チャンク番号を詰めない）。`getAll` は空チャンクを自然にスキップ。`hashToChunk` から当該 `urlHash` を削除する。
- **1ファイル300行以下**を目安（`docs/repository-structure.md`）。閾値・キー等の定数はファイル冒頭にまとめる。

## データフロー

### upsert（別名の登録/更新）
```
1. urlHash = normalizer.hashUrl(url)           // 不正URLは TypeError を素通し
2. deduped = validateAndDedup(aliases)         // 個数/文字数検証 → AliasLimitError、正規化重複排除
3. index = await loadIndex()
4. record = { urlHash, url, aliases: deduped, updatedAt: Date.now() }
5. chunkNo = pickChunkFor(record, index, index.storageMode)
6. chunk = await readChunk(mode, chunkNo); chunk[urlHash] = record
7. index.hashToChunk[urlHash] = chunkNo; index.chunkCount = max(chunkCount, chunkNo+1)
8. withQuotaFailover(mode, () => write(alias_chunk_${chunkNo}=chunk, alias_index=index))
   └─ sync 容量超過なら failoverToLocal → local に再書き込み
```

### merge（インポート時の別名和集合）
```
1. existing = await getByUrl(url)              // なければ aliases=[]
2. union = [...existing.aliases, ...incoming]  // 既存先勝ち
3. upsert(url, union)                           // 検証・重複排除・保存を再利用
4. return (await getByUrl(url))!                // マージ後の AliasRecord を返す
```

### getAll / getByUrl（読み出し）
```
getByUrl: hash → loadIndex → chunkNo=hashToChunk[hash] → readChunk → record ?? null
getAll : loadIndex → for no in 0..chunkCount-1: readChunk → Object.entries を Map へ集約
```

### sync → local フォールバック
```
1. sync.set が reject（QUOTA） を捕捉
2. failoverToLocal: sync の alias_index + alias_chunk_0..N を読む
3. local.set で index(storageMode='local') と全チャンクを書く
4. sync.remove で alias_* を削除
5. 失敗した書き込みを local に対して再実行
```

## エラーハンドリング戦略

### カスタムエラークラス
- `AliasLimitError`（上記）。`kind` で count/length を区別。

### エラーハンドリングパターン
- 別名上限は `AliasLimitError` を throw（呼び出し側 U9 が UI 表示）。
- 不正 URL は `Normalizer.hashUrl` 経由の `TypeError` を握り潰さず素通し（早期失敗。`docs` の Normalizer 方針に一致）。
- sync 書き込み失敗は握り潰さず、**local フォールバックで回復**してデータ損失を防ぐ（`docs/development-guidelines.md`「Chrome API 失敗時はロールバック/回復」）。回復不能な想定外は `console.error` を残して上位へ再throw。

## テスト戦略

`packages/storage/lib/impl/aliasStore.test.ts`（co-located）。既存の `bookmarkService.test.ts` に倣い、`vi.stubGlobal('chrome', chromeMock)` で chrome を差し替える。`chrome.storage.sync` / `local` は **Map バックのインメモリ実装**（`get([keys])→object` / `set(obj)` / `remove(keys)`）を用意し、必要なテストでのみ `sync.set` を一度だけ reject させてフォールバックを検証する。

Normalizer は shared から import しない（クロスパッケージのテスト依存/循環を避ける）。テスト用に `AliasNormalizer` を満たす軽量スタブ（`normalizeText = NFKC+小文字化`、`hashUrl = 正規化URL文字列`）を用意する。

### ユニットテスト（`[対象]_[条件]_[期待結果]` 命名）
- `upsert_同一URLで再登録_getByUrlが最新別名を返す`
- `upsert_正規化後に重複する別名_重複が排除される`
- `upsert_21個目の別名_AliasLimitError(count)をスローする`
- `upsert_51文字の別名_AliasLimitError(length)をスローする`
- `upsert_多数レコード投入_バイト長閾値超過で新チャンクに分割される`（chunkCount 増加を検証）
- `getAll_複数チャンク_全レコードを結合して返す`
- `getByUrl_表記ゆれURL_同一レコードに解決される`
- `remove_既存レコード_getByUrlがnull_hashToChunkから除去される`
- `merge_既存と入力_和集合がマージされ重複排除される`
- `upsert_syncがQUOTAで失敗_localへ退避しstorageModeがlocalになる`
- `フォールバック後_upsert/getByUrl_localに対して動作しデータが残る`

### 統合テスト
- 本単位ではユニットのみ（chrome モック）。別名付与→検索ヒットの統合は U6 以降で扱う。

## 依存ライブラリ

新規追加なし（vitest / coverage-v8 は U2 で導入済み）。

## ディレクトリ構造

```
packages/storage/
├── lib/
│   ├── impl/
│   │   ├── aliasStore.ts         # ★新規: AliasStore / AliasLimitError / AliasNormalizer
│   │   ├── aliasStore.test.ts    # ★新規: ユニットテスト
│   │   └── index.ts              # 変更: export * from './aliasStore.js' を追加
│   └── types.ts                  # 変更なし（Alias* 型は U3/U4 で定義済み）
└── vitest.config.ts              # 変更: coverage.thresholds 80% を有効化

packages/shared/
├── lib/
│   └── stores/
│       └── index.ts              # ★新規: aliasStore シングルトン合成（= new AliasStore(normalizer)）
└── index.mts                     # 変更: stores を re-export
```

## 実装の順序

1. `aliasStore.ts`: 定数・`AliasNormalizer`・`AliasLimitError`・検証/重複排除ヘルパ
2. `aliasStore.ts`: index/チャンク読み書き・`getByUrl` / `getAll`
3. `aliasStore.ts`: `upsert`（分割ロジック含む）・`merge` / `remove`
4. `aliasStore.ts`: `failoverToLocal` / `withQuotaFailover`
5. storage `impl/index.ts` に export 追加
6. shared に `aliasStore` シングルトン合成を追加し index から re-export
7. `aliasStore.test.ts`: インメモリ chrome モック + 全ケース
8. `vitest.config.ts` に coverage thresholds 80% を有効化
9. 品質チェック（test / lint / type-check）

## セキュリティ考慮事項

- 外部通信を一切行わない（`fetch`/XHR/WebSocket 不使用。プライバシー方針）。`chrome.storage` のみ。
- 別名・URL はユーザーローカルデータ。ログに生データを大量出力しない。

## パフォーマンス考慮事項

- upsert は原則「対象チャンク + index」の 2 キーだけを書く（全書き込みしない）→ 100ms 以内目標。
- `getAll` は全チャンク読み込みだが sync/local の一括 `get` でまとめて取得。SearchEngine（U6）は起動時に一度読む想定。
- バイト長計測は書き込み対象チャンクにのみ行い、毎回全走査しない。

## 将来の拡張性

- `AliasIndex` に `storageMode` を持つため、将来 local→sync の復帰や手動同期も拡張可能。
- スキーマ version 化（`merge` のマイグレーション）は U15 import-export の JSON フォーマット側で吸収する想定。
- 空チャンクの再利用/コンパクションは必要になれば別単位で最適化（現状は番号を詰めない単純方針）。
