# 要求内容

## 概要

`packages/storage`（データレイヤー）に、Chrome API を抽象化する **BookmarkService**（`chrome.bookmarks` / `chrome.tabs` / `chrome.runtime` ラッパ）と、ユーザー設定・端末状態を扱う **SettingsStore** / **LocalStateStore** を実装する。UI・サービス層が chrome API を直接触らないための土台であり、U6（SearchEngine）・U10（インライン編集）・U12（移動）・U14（現在ページ登録）等が依存する（作業単位 U4）。

## 背景

- 本作業は [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) の作業単位 **U4 (bookmark-service)** に対応する（依存: U1・U2 = 完了済み）。
- [docs/functional-design.md](../../docs/functional-design.md) が BookmarkService / UserSettings / LocalState の責務と API を定義している:
  - BookmarkService: `getTree` / `getFolderPath` / `ensureFolderPath` / `create` / `rename` / `updateUrl` / `move` / `remove` / `getCurrentTab` / `faviconUrl`
  - UserSettings（sync）: `trashRetentionDays`（既定30）・`locale?`
  - LocalState（local）: `expandedFolderIds` / `lastUsedFolderId?`
- [docs/architecture.md](../../docs/architecture.md) のレイヤー依存（UI→サービス→データ）に従い、chrome API アクセスをデータ層に閉じ込める。特に `faviconUrl` は `chrome.runtime.id` を要するため、UI から `chrome.*` を触らせないよう BookmarkService に集約する（functional-design「レイヤー遵守」）。

## 実装対象の機能

### 1. BookmarkService（`packages/storage/lib/impl/bookmarkService.ts`）
- `getTree(): Promise<BookmarkNode[]>` — chrome.bookmarks のツリーを取得し、ドメイン型 `BookmarkNode` に変換して返す。
- `getFolderPath(nodeId): Promise<string[]>` — ノードからルートまで辿り、フォルダ名の配列（パス）を返す。
- `ensureFolderPath(path: string[]): Promise<string>` — パスを上から辿り、無いフォルダは自動作成して末端フォルダの ID を返す。
- `create({ url?, title, parentId }): Promise<BookmarkNode>` — ブックマーク/フォルダを作成。
- `rename(id, title)` / `updateUrl(id, url)` / `move(id, parentId)` / `remove(id)` — 編集・移動・削除。
- `getCurrentTab(): Promise<{ url: string; title: string }>` — アクティブタブの URL/タイトルを取得（activeTab）。
- `faviconUrl(pageUrl, size?): string` — `chrome-extension://<runtime.id>/_favicon/?pageUrl=...&size=...` を組み立てて返す（同期）。

### 2. SettingsStore（`packages/storage/lib/impl/settingsStore.ts`）
- `UserSettings`（`trashRetentionDays` 既定30 / `locale?`）を `chrome.storage.sync` に永続化。既存の `createStorage`（base）を再利用し、キーは `user_settings`。

### 3. LocalStateStore（`packages/storage/lib/impl/localStateStore.ts`）
- `LocalState`（`expandedFolderIds` / `lastUsedFolderId?`）を `chrome.storage.local` に永続化。既存 `createStorage` を再利用。

### 4. 型・公開 API
- `UserSettings` / `LocalState` を storage 層に定義する。
- `BookmarkNode` 等のドメイン型の帰属は「未確定の論点」で決定した方針に従う（下記）。
- `@extension/storage`（`index.mts` → `lib/index.ts` → `impl/index.ts`）からバレル公開する。

## 受け入れ条件

### BookmarkService
- [ ] `getTree` が chrome.bookmarks のツリーを `BookmarkNode[]` に変換して返す
- [ ] `getFolderPath` がルートまで辿ってフォルダ名配列を返す
- [ ] `ensureFolderPath` が既存フォルダを再利用し、無い階層のみ作成して末端 ID を返す（フォルダ自動作成が動作）
- [ ] `create` / `rename` / `updateUrl` / `move` / `remove` が対応する chrome.bookmarks API を正しく呼ぶ
- [ ] `getCurrentTab` がアクティブタブの url/title を返す（現在タブ取得が動作）
- [ ] `faviconUrl` が `chrome.runtime.id` を用いた `_favicon` URL を返し、`size` を反映する
- [ ] UI/サービスが chrome API を直接触らずに済む API 面になっている

### SettingsStore / LocalStateStore
- [ ] `SettingsStore` が `user_settings`（sync）で get/set でき、既定 `trashRetentionDays=30` を返す
- [ ] `LocalStateStore` が `local_state`（local）で get/set でき、`expandedFolderIds` 既定 `[]` を返す

### 品質ゲート
- [ ] chrome API をモックした vitest で BookmarkService の主要メソッドがテストされ、パスする
- [ ] `pnpm -F @extension/storage test` が通る
- [ ] `pnpm type-check` / `pnpm lint` / `pnpm build` がエラーなく通る

## 成功指標
- UI/サービス層が `chrome.bookmarks` / `chrome.tabs` / `chrome.runtime` を直接呼ばずに、フォルダパス解決・自動作成・現在タブ取得・ファビコン URL 生成を行える。
- 後続 U6/U10/U12/U14 が BookmarkService に依存して実装を進められる。

## スコープ外

以下はこのフェーズでは実装しません:

- AliasStore（チャンク分割・sync/local フォールバック）: U5
- TrashStore（ゴミ箱）: U16
- SearchEngine 本体: U6
- Service Worker の起動時クリーンアップ: U17
- UI コンポーネント（FolderTree / Favicon 等）: 各 UI 作業単位
- `locale` に基づく実際の i18n 適用（型の受け皿のみ用意。適用は U18）

## 未確定の論点（承認前に判断が必要）

### 【最重要】ドメインデータ型の帰属とレイヤー依存

**問題**: `repository-structure.md` は「`packages/storage` 依存禁止: `packages/shared`」(L166) とする一方、「`packages/shared/lib/types/` にドメイン型（AliasRecord 等）を置く」(L136) とも記す。U3 で `BookmarkNode` / `AliasRecord` 系を `packages/shared/lib/types/` に置いたが、U4 の `BookmarkService.getTree(): BookmarkNode[]`（および U5 の AliasStore）は storage 層でこれらの型を必要とする。**storage が shared を import できないと、この型を使えない。**

**選択肢**:
- **案B（推奨・最小変更）: 「型のみ import は依存禁止の対象外」と解釈する。** storage から `import type { BookmarkNode } from '@extension/shared'` を許可する。型は完全にコンパイル時消去され実行時結合ゼロのため、L166 の趣旨（ビジネスロジックを持ち込まない）に反しない。U3 の成果物（型は shared のまま）を変更せずに済む。→ `repository-structure.md` の依存規約に「型のみ import は許可」の注記を追加する。
- **案A（厳格）: データモデル型を storage に移す。** `BookmarkNode` / `AliasRecord` / `AliasChunk` / `AliasIndex` を `packages/storage/lib/types.ts` へ移設し、`packages/shared` がそれらを再エクスポートする（shared→storage は許可）。サービス層固有の `SearchResultItem` / `FolderScope` は shared に残す。実行時も含め完全にレイヤー順守だが、**U3 の型配置を変更**する（`@extension/shared` からの参照は再エクスポートで維持）。

→ **【決定: 案A を採用（2026-07-25）】** 当初 案B を推奨し承認されたが、実装着手時の検証で **案B は turbo の循環依存を発生させビルドを壊す**ことが判明した:
- `shared` は既に `storage` を型参照している（`use-storage.tsx` の `BaseStorageType`）。ここへ案Bの `storage → shared` を足すと **shared ⇄ storage の相互依存**となり、`turbo run build --dry` が `Cyclic dependency detected: @extension/storage, @extension/shared` を報告（`^ready`/`^build` の順序解決が循環）。
- 案Bを成立させるには既存の `shared → storage`（BaseStorageType）も剥がす必要があり、最小変更にならない。
- したがって **案B は不成立**。データモデル型を最下層 `storage` に置き、依存を `shared → storage` の一方向に保つ **案A** が唯一の循環なし解であり、レイヤー（UI→サービス→データ）にも完全整合する。ユーザー承認済み（2026-07-25）。

### その他
- **`getTree` の返却変換**: chrome の `BookmarkTreeNode` を丸ごと返さず、ドメイン `BookmarkNode`（必要フィールドのみ）へ写像する方針を推奨（chrome 型への UI 依存を避ける）。
- **`faviconUrl` の既定サイズ**: functional-design は `size?` のみ規定。既定 `16`（一覧行の標準）を推奨。
- **テストの chrome モック方式**: `vi.stubGlobal('chrome', {...})` で `bookmarks`/`tabs`/`runtime` を差し替える方式を推奨（BookmarkService は `globalThis.chrome` を参照）。

## 参照ドキュメント

- [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) - 作業単位 U4
- [docs/functional-design.md](../../docs/functional-design.md) - BookmarkService / UserSettings / LocalState / レイヤー遵守（faviconUrl）
- [docs/architecture.md](../../docs/architecture.md) - レイヤー依存（UI→サービス→データ）
- [docs/repository-structure.md](../../docs/repository-structure.md) - `packages/storage/lib/impl/` 配置・依存規約（本件の論点）
