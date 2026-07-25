# 設計書

> **【確定: 案A を採用】**（案B は turbo 循環依存でビルド不可のため却下。requirements.md 参照）
> データモデル型（`BookmarkNode` / `AliasRecord` / `AliasChunk` / `AliasIndex`）を `packages/shared/lib/types/` から
> `packages/storage/lib/types.ts` へ移設し、`packages/shared` はそれらを `@extension/storage` から再エクスポートする。
> `SearchResultItem` / `FolderScope` は shared に残す。依存は `shared → storage` の一方向（循環なし）。
> storage は内部パッケージに依存しない（`BookmarkNode` は storage 内の相対 import）。

## アーキテクチャ概要

`packages/storage`（データレイヤー・最下層）に Chrome API ラッパと設定/状態ストアを追加する。BookmarkService は `chrome.bookmarks`/`tabs`/`runtime` を薄くラップし、chrome の `BookmarkTreeNode` をドメイン型 `BookmarkNode`（U3, `@extension/shared`）へ写像する。SettingsStore/LocalStateStore は既存の `createStorage`（base）を再利用する。

```
packages/storage/lib/
├── impl/
│   ├── bookmarkService.ts   # ← 本単位: chrome.bookmarks/tabs/runtime ラッパ（class）
│   ├── bookmarkService.test.ts
│   ├── settingsStore.ts     # ← 本単位: UserSettings(sync) via createStorage
│   ├── localStateStore.ts   # ← 本単位: LocalState(local) via createStorage
│   ├── example-theme-storage.ts (既存)
│   └── index.ts             # バレルに追加
├── types.ts                 # ← 本単位: UserSettings / LocalState を追加（案A時は BookmarkNode 等も）
├── base/ (既存 createStorage)
└── index.ts

依存: storage → @extension/shared（案B: 型のみ import）。実行時結合なし。
```

## コンポーネント設計

### 1. BookmarkService（class, `impl/bookmarkService.ts`）

**責務**: chrome.bookmarks/tabs/runtime の薄いラッパ。フォルダパス解決・自動作成・現在タブ取得・ファビコン URL 生成。

**実装の要点**:
- `globalThis.chrome` を参照（base.ts と同じ流儀）。chrome 未定義環境（テスト等）ではモックを `vi.stubGlobal` で注入する。
- `getTree()`: `chrome.bookmarks.getTree()` → ルート配列を再帰的に `BookmarkNode` へ写像する `toDomain(node)` ヘルパ（`id`/`parentId`/`title`/`url`/`dateAdded`/`children` のみ）。
- `getFolderPath(nodeId)`: `chrome.bookmarks.get(id)` で親を辿り、ルート（`parentId` 無し or ルートID）まで登ってタイトル配列を返す（ルート自身は含めない方針。順序は上位→末端）。
- `ensureFolderPath(path)`: ルート直下から `path` を1階層ずつ照合。`chrome.bookmarks.getChildren` で同名フォルダ（`url` 無しノード）を探し、無ければ `chrome.bookmarks.create({ parentId, title })`。末端の ID を返す。ベース親は「ブックマークバー」（`getTree` のルートの最初の子）を既定にする。
- `create/rename/updateUrl/move/remove`: それぞれ `create` / `update(id,{title})` / `update(id,{url})` / `move(id,{parentId})` / `remove(id)` を呼ぶ。`create` は結果を `BookmarkNode` に写像して返す。
- `getCurrentTab()`: `chrome.tabs.query({ active: true, currentWindow: true })` の先頭から `{ url, title }` を返す。`url`/`title` が無い場合は空文字にフォールバック（`chrome://` 等で activeTab 権限が無いケースを考慮。U1 の学び）。
- `faviconUrl(pageUrl, size = 16)`: `new URL(chrome.runtime.getURL('/_favicon/'))` に `pageUrl` と `size` を `searchParams` で付与して文字列化。`chrome.runtime.id` へのアクセスをここに閉じ込める。
- func-style（eslint）に配慮し、モジュール内補助関数はアロー `const`、メソッドはクラスメソッドで定義。
- 既定インスタンス `export const bookmarkService = new BookmarkService()` も提供（Normalizer と同じ流儀）。

### 2. SettingsStore（`impl/settingsStore.ts`）

**責務**: `UserSettings` を sync に永続化。

**実装の要点**:
- `createStorage<UserSettings>('user_settings', { trashRetentionDays: 30 }, { storageEnum: StorageEnum.Sync, liveUpdate: true })` を基盤に、`BaseStorageType<UserSettings>` を公開。
- 追加の利便メソッド（例: `setRetentionDays(n)` / `setLocale(l)`）を薄く載せる（example-theme-storage.ts の拡張パターンに倣う）。

### 3. LocalStateStore（`impl/localStateStore.ts`）

**責務**: `LocalState` を local に永続化。

**実装の要点**:
- `createStorage<LocalState>('local_state', { expandedFolderIds: [] }, { storageEnum: StorageEnum.Local, liveUpdate: true })`。
- 利便メソッド（例: `setLastUsedFolder(id)` / `toggleExpanded(folderId)`）を薄く載せる。

### 4. 型（`types.ts`）

- `UserSettings` / `LocalState` を `packages/storage/lib/types.ts` に追加（`export type`）。
- 案B: `BookmarkNode` は `@extension/shared` から `import type` して利用（storage 内に再定義しない）。
- 案A採用時: `BookmarkNode`/`AliasRecord`/`AliasChunk`/`AliasIndex` を本ファイルへ移設し、`packages/shared/lib/types/` は storage から再エクスポート。

## データフロー

### フォルダ自動作成つき登録（U14 が利用）
```
1. ensureFolderPath(['開発','記事']) を呼ぶ
2. ルート直下→'開発' を getChildren で探索、無ければ create
3. '開発' 配下→'記事' を探索/create、末端 ID を返す
4. create({ url, title, parentId: 末端ID }) でブックマーク作成
```

### ファビコン表示（U7/U10 が利用）
```
1. faviconUrl('https://ex.com/a', 16) → 'chrome-extension://<id>/_favicon/?pageUrl=...&size=16'
2. UI はこの文字列を <img src> に渡すだけ（chrome.* を触らない）
3. onerror で頭文字アバターにフォールバック（UI 側の責務、本単位外）
```

## エラーハンドリング戦略

### カスタムエラークラス
- 本単位では新規エラークラスは導入しない。chrome API の reject はそのまま伝播（呼び出し側で扱う）。

### エラーハンドリングパターン
- `getCurrentTab`: `tabs.query` 結果が空、または `url`/`title` 未定義（`chrome://` 等）でも throw せず空文字へフォールバック（UI 実装 U1 の学びを反映）。
- `ensureFolderPath`: 空配列は「ベース親（ブックマークバー）ID」を返す（何も作らない）。
- chrome API 呼び出しは Promise 版（MV3 の Promise 対応）を使用。callback 版は使わない。

## テスト戦略

### ユニットテスト（`impl/bookmarkService.test.ts`, co-located, chrome モック）
- `vi.stubGlobal('chrome', mock)` で `bookmarks.getTree/get/getChildren/create/update/move/remove`、`tabs.query`、`runtime.getURL/id` を差し替える。
- `getTree`: モックツリー → `BookmarkNode[]` 写像（不要フィールド除去・children 再帰）を検証。
- `ensureFolderPath`: 既存フォルダ再利用（create を呼ばない）／欠落階層のみ create を呼ぶ／末端 ID 返却、を検証（`create` 呼び出し回数・引数を assert）。
- `getFolderPath`: 親を辿ってパス配列（順序）を返すことを検証。
- `create/rename/updateUrl/move/remove`: 対応 chrome API が正しい引数で呼ばれることを検証。
- `getCurrentTab`: 正常／`url`欠落フォールバックを検証。
- `faviconUrl`: 生成 URL に `pageUrl`/`size` が含まれ、`runtime.id` 由来のオリジンであることを検証。
- SettingsStore/LocalStateStore: `chrome.storage` をモックし、既定値取得・set 反映をスモーク的に検証（createStorage 自体は既存基盤のため薄く）。

### カバレッジ
- storage 80% 目標（本単位で BookmarkService の分岐を厚めに）。閾値 gate 化は U2 方針どおり後続。

## 依存ライブラリ

- 新規追加なし。`@types/chrome`（root devDeps 既存）で chrome 型を利用。vitest は U2 導入済み。案B では `@extension/shared`（workspace, 既存 devDependency 追加が必要なら storage の package.json に追記）。

## ディレクトリ構造

```
packages/storage/
  package.json                # 案B: devDependencies に @extension/shared: workspace:* を追加（型 import 用）
  lib/
    types.ts                  # UserSettings / LocalState 追加（案A時は BookmarkNode 等も）
    impl/
      bookmarkService.ts      # 新規
      bookmarkService.test.ts # 新規
      settingsStore.ts        # 新規
      localStateStore.ts      # 新規
      index.ts                # 3ファイルを再エクスポート
```

## 実装の順序

1. 論点【最重要】の決定（ゲート4.5）。案Bなら storage に `@extension/shared`（型用）を追加。案Aなら型移設を先に行う。
2. `types.ts` に `UserSettings` / `LocalState` を追加。
3. `bookmarkService.ts` を実装（写像ヘルパ → 各メソッド）。
4. `settingsStore.ts` / `localStateStore.ts` を `createStorage` ベースで実装。
5. `impl/index.ts` バレル更新。
6. `bookmarkService.test.ts`（+ ストアのスモーク）を chrome モックで作成。
7. 品質チェック（`pnpm -F @extension/storage test` / 全体 type-check / lint / build）。

## セキュリティ考慮事項

- 外部通信ゼロを維持（chrome API のみ、`fetch` 等なし）。`faviconUrl` は拡張内部の `_favicon` を指す URL 文字列を返すだけで、外部へ問い合わせない。
- 最小権限（U1: bookmarks/storage/activeTab/favicon）の範囲内で動作。host permission を要求しない。

## パフォーマンス考慮事項

- `getTree` は起動時先読み対象（functional-design）。写像は O(ノード数) で軽量。
- `ensureFolderPath` は階層数ぶんの getChildren を伴うが、フォルダ階層は浅く実用上問題なし。

## 将来の拡張性

- `faviconUrl` の size 可変、`getTree` 写像フィールドの追加は後方互換で拡張可能。
- 案B/案A いずれでも、`@extension/storage` / `@extension/shared` の公開 API 面（consumer から見た import 元）は維持できるよう設計する。
