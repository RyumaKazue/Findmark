# 設計 — U15 import-export

## 方針

- レイヤー依存（UI → サービス → データ）を厳守。`ImportExportService` は `packages/shared` に置き、chrome API には一切触れず、`BookmarkService`/`AliasStore` を構造的インターフェース（`SearchEngine` と同じ DI 方針）で受ける。
- `packages/shared` は React/DOM API 依存禁止（repository-structure.md）のため、`Blob`/`File`/`DOMParser` を一切使わない。ファイルI/O・ダウンロードトリガーは `pages/options`（ブラウザ層）が担う。HTML(Netscape Bookmark File)は正規な入れ子構造のため、DOM 不要の手書きパーサで足りる。
- 3系統の重複解決・version マイグレーションは純粋ロジックとして切り出し、`packages/shared` の既存ユニットテスト方針（Node環境）にそのまま乗せる。

## モジュール構成

### `packages/shared/lib/import-export/jsonFormat.ts`

```ts
interface ImportBookmark {
  url: string;
  title: string;
  folderPath: string[];
  aliases: string[];
  addedAt?: number; // epoch ms（ファイル上は ISO8601 文字列。parse 時に変換する）
}

interface ExportBookmark {
  url: string;
  title: string;
  folderPath: string[];
  aliases: string[];
  addedAt?: number;
}

const CURRENT_VERSION = 1;
const FORMAT_ID = 'my-bookmark-search';

/** 生JSON文字列を検証し ImportBookmark[] へ変換する。format/version 不正・パース不能は throw する。 */
function parseJsonFile(rawText: string): ImportBookmark[]

/** 現行 version で独自JSON文字列を生成する。 */
function serializeJsonFile(bookmarks: ExportBookmark[]): string
```

- `parseJsonFile`: `JSON.parse` → `format !== 'my-bookmark-search'` または `typeof version !== 'number'` なら `throw new Error('unsupported-format')`。`version` ごとに switch し、現状は `1` のみ許可（それ以外は `throw new Error('unsupported-version')`）。各 `bookmarks[]` 要素は `url`/`title` が string でなければスキップせず該当要素だけ無効データとして除外する（配列全体を壊さない）。`addedAt`（ISO8601）は `Date.parse` で epoch ms に変換し、失敗時は `undefined` にする（インポート自体は続行）。
- `serializeJsonFile`: `exportedAt: new Date().toISOString()`、各 `addedAt` を ISO8601 へ変換して出力する。

### `packages/shared/lib/import-export/htmlFormat.ts`

```ts
/** Netscape Bookmark File のテキストを ImportBookmark[] へ変換する（別名は常に空配列）。 */
function parseHtmlFile(html: string): ImportBookmark[]

/** BookmarkNode[]（getTree() の結果）から Netscape Bookmark File のテキストを生成する。 */
function serializeHtmlFile(tree: BookmarkNode[]): string
```

- **パーサ**: DOM 不要のタグベース走査。`<H3[^>]*>(.*?)<\/H3>`（フォルダ名）・`<A\s+HREF="([^"]*)"[^>]*>(.*?)<\/A>`（ブックマーク）・`<DL>`/`</DL>`（階層の開始/終了）を順にマッチさせ、`folderPath` スタックを push/pop しながら `<A>` に遭遇するたびその時点のスタックを `folderPath` として記録する。HTML エンティティ（`&amp;`/`&lt;`/`&gt;`/`&quot;`/`&#39;`）は簡易デコードする。
- **シリアライザ**: `walk(nodes, depth)` で再帰し、フォルダは `<DT><H3>title</H3>\n<DL><p>\n...\n</DL><p>`、ブックマークは `<DT><A HREF="url" ADD_DATE="epochSeconds">title</A>` を出力する（別名は含めない。functional-design の明記どおり）。真のルート（`parentId` 無し）は見出しを出さずその子から始める（`SearchEngine`/`folderTreeModel` の「真のルートは畳む」規約に合わせる）。

### `packages/shared/lib/import-export/ImportExportService.ts`

```ts
interface BookmarkOps {
  getTree(): Promise<BookmarkNode[]>;
  findByUrl(url: string): Promise<BookmarkNode | null>;   // U14 で追加済み
  getFolderPath(id: string): Promise<string[]>;
  ensureFolderPath(path: string[]): Promise<string>;
  create(data: { url?: string; title: string; parentId: string }): Promise<BookmarkNode>;
  rename(id: string, title: string): Promise<void>;
  move(id: string, parentId: string): Promise<void>;
}
interface AliasOps {
  getAll(): Promise<Map<string, AliasRecord>>;
  upsert(url: string, aliases: string[]): Promise<void>;
  merge(url: string, incoming: string[]): Promise<AliasRecord>;
}
interface ImportNormalizer {
  hashUrl(url: string): string;
}

type ConflictResolution = 'skip' | 'overwrite' | 'keepBoth';
interface ConflictResolver {
  resolve(existing: BookmarkNode, existingFolderPath: string[], incoming: ImportBookmark):
    Promise<{ resolution: ConflictResolution; applyToAll: boolean }>;
}

interface ImportReport {
  total: number;
  created: number;
  aliasMerged: number;
  skipped: number;
  overwritten: number;
  keptBoth: number;
  errors: { url: string; reason: string }[];
}

class ImportExportService {
  constructor(
    private readonly normalizer: ImportNormalizer,
    private readonly bookmarks: BookmarkOps,
    private readonly aliases: AliasOps,
  ) {}

  async exportJson(): Promise<string> { /* getTree() + aliases.getAll() を突合して walk */ }
  async exportHtml(): Promise<string> { /* serializeHtmlFile(await this.bookmarks.getTree()) */ }
  async importHtml(rawText: string): Promise<ImportReport> { /* parseHtmlFile → 新規作成のみ */ }
  async importJson(rawText: string, resolver: ConflictResolver): Promise<ImportReport> { /* UC-4 */ }
}
```

**`importJson` の1件ごとの分岐（UC-4）**:

1. `parseJsonFile(rawText)` で全件パース（失敗時は呼び出し側までそのまま throw させる＝「パース失敗は中断・部分適用しない」。`ImportReport` を返さない）。
2. `applyToAll: {resolution: ConflictResolution} | null` を1つ保持（一括適用の記憶）。
3. 各 `incoming` について:
   - `existing = await bookmarks.findByUrl(incoming.url)`（不正URLで `hashUrl`/`findByUrl` が失敗したら `errors` に積んで次へ）。
   - **`existing === null`**: `parentId = await ensureFolderPath(incoming.folderPath)` → `create({url, title, parentId})` → `incoming.aliases.length > 0` なら `aliases.upsert(url, incoming.aliases)` → `created++`。
   - **`existing !== null`**: `existingFolderPath = await getFolderPath(existing.id)`。`existing.title === incoming.title && 同じfolderPath` なら:
     - `incoming.aliases.length > 0` → `aliases.merge(url, incoming.aliases)` → `aliasMerged++`
     - それ以外 → `skipped++`（既に完全一致・何もしない）
   - それ以外（タイトルまたはフォルダが相違＝真の競合）:
     - `resolution = applyToAll?.resolution ?? (await resolver.resolve(existing, existingFolderPath, incoming)).resolution`（`applyToAll` が立っていれば2回目以降はダイアログを出さない）。初回の解決で `applyToAll: true` が返れば以後の競合すべてに記憶を適用する。
     - `skip` → `skipped++`
     - `overwrite` → `parentId = await ensureFolderPath(incoming.folderPath)` → `rename(existing.id, incoming.title)` + `move(existing.id, parentId)` → 別名も追加でマージ（`incoming.aliases.length>0` なら `merge`）→ `overwritten++`
     - `keepBoth` → 新規作成側と同じ手順（`ensureFolderPath`+`create`+`upsert/merge`）で**別ノードとして追加**→ `keptBoth++`
4. 1件の失敗（chrome API 例外等）は `errors` に積んで次の件へ継続する（全体は中断しない。パース失敗との違いを明確にする）。

**`exportJson` の突合手順**: `SearchEngine.buildIndex` と同じ「真のルートを畳みつつ `folderPath` を積む」木の走査を行い、`url` を持つ葉ノードごとに `hashUrl` で `aliases.getAll()` の結果を引く（不正URLは別名なしとして続行。索引構築と同じ防御）。

## Options UI

### `pages/options/src/services.ts`

```ts
export const aliasStore = new AliasStore(normalizer);
export const importExportService = new ImportExportService(normalizer, bookmarkService, aliasStore);
export { bookmarkService };
```

popup の `services.ts` と同じ「DIが要るクラスをここで1回だけ生成する」集約パターン。

### `ImportExportTab.tsx`

- エクスポート: 「独自JSONをエクスポート」「標準HTMLをエクスポート」の2ボタン。`importExportService.exportJson()/exportHtml()` の文字列結果を、ここで初めて `new Blob([text], {type})` に包み `URL.createObjectURL` + 一時 `<a download>` で保存する（DOM/Blob はここでのみ使用）。
- インポート: `<input type="file" accept=".json,.html">` → `file.text()` で文字列化 → 拡張子/内容（`.json` or `format` フィールドの有無）で `importJson`/`importHtml` を判定して呼ぶ。
- `importJson` は競合が出るたびに `ConflictDialog` を表示して `Promise` を解決させる `ConflictResolver` をこのコンポーネントが実装する（`resolve` を `useState` + `Promise` の resolve 関数を保持する定石パターンで実装）。
- 完了後 `ImportReport` をサマリ表示する（作成/マージ/スキップ/上書き/両方保持/エラー件数）。

### `ConflictDialog.tsx`

- Props: `existing: {title, folderPath}`, `incoming: ImportBookmark`, `onResolve(resolution, applyToAll)`。
- 既存/新規のタイトル・フォルダパスを並べて表示し、`[スキップ]`/`[上書き]`/`[両方残す]` ボタンと「残りの競合にも適用する」チェックボックス。

### `Options.tsx`

- U7 と同じ扱いでボイラープレート（`exampleThemeStorage`/ロゴ）を置換し、`ImportExportTab` を描画するシェルにする。将来 U16 で `TrashTab`/`SettingsTab` を追加するタブ構造の土台を作るが、本単位ではタブ切り替えUIは最小限（今は ImportExportTab 単体でも成立するため、複数タブ機構は U16 着手時に導入する。過剰な先取りをしない）。

## docs/functional-design.md への是正

`ImportExportService` のインターフェース例に「実装状況(U15, 2026-08-08)」の注記を追加し、`Promise<Blob>`→`Promise<string>`、`file: File`→`rawText: string`、`resolve(...)`（同期）→`Promise<{...}>`（非同期）への変更理由（`packages/shared` の DOM API 依存禁止・実際のUI確認は非同期を要する）を記録する（UC-5 の「実装状況」注記と同じ形式）。

## テスト方針

- `jsonFormat.test.ts`: 正常パース、`format`/`version` 不正時の throw、`addedAt` ISO8601⇄epoch変換、シリアライズの往復一致。
- `htmlFormat.test.ts`: ネストしたフォルダ構造のパース、HTMLエンティティのデコード、シリアライズ（フォルダ階層の再現）、往復（parse→serialize→parseで同じ集合になる）。
- `ImportExportService.test.ts`: `importJson` の3系統（新規/別名マージ/競合resolve）、`applyToAll` の一括適用、1件失敗時の継続（`errors`蓄積・他件への影響なし）、`importHtml` の新規作成のみ動作、`exportJson`/`exportHtml` の出力内容。モック `BookmarkOps`/`AliasOps` で chrome 非依存にテストする。
- 品質ゲート: `pnpm test` / `pnpm lint` / `pnpm type-check`（前景で実 exit code 確認）。
