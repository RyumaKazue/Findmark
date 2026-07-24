# 要求内容

## 概要

`chrome-extension/manifest.ts` を Findmark の最小権限構成へ是正する。権限を `bookmarks` / `storage` / `activeTab` / `favicon` の4つに揃え、ボイラープレート由来の不要エントリ（`content_scripts`、`devtools_page`、過剰な `web_accessible_resources`）を除去する。これは MVP のあらゆる機能実装の前提となる基盤タスク（作業単位 U1）である。

## 背景

- 本作業は [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) の作業単位 **U1 (manifest-permissions)** に対応する。
- [docs/architecture.md](../../docs/architecture.md) 「技術的制約 > 現状ギャップ」が実装着手時の必須対応として明記している。現状の manifest はボイラープレート初期状態で、本プロダクトの「外部通信ゼロ・host permission 不要・最小権限」をまだ満たしていない:
  - `permissions: ['storage']` のみ。`bookmarks` 等が無く、ブックマーク操作・ファビコン取得ができない。
  - `content_scripts` が `<all_urls>` にマッチ。Findmark はコンテンツスクリプトを使わないのに「すべてのサイトのデータ読み取り/変更」相当の警告対象になり得る。
  - `web_accessible_resources` を `*://*/*` へ広範公開している。
  - 不要な `devtools_page` エントリが残存している。
- 最小権限・データ収集なしは PRD「セキュリティ / プライバシー」でプロダクトの信頼性の核と位置づけられており、審査・ユーザー信頼の両面で先に是正しておく必要がある。

## 実装対象の機能

### 1. permissions の是正
- `permissions` を `['bookmarks', 'storage', 'activeTab', 'favicon']` にする。
- `host_permissions` は追加しない。

### 2. content_scripts の削除
- `content_scripts` ブロックを manifest から削除する（Findmark はコンテンツスクリプトを使わない）。

### 3. web_accessible_resources の最小化
- `*://*/*` への広範公開をやめ、必要最小限に絞る（不要であれば削除する）。

### 4. 不要エントリの整理
- `devtools_page` エントリを削除する。
- `action.default_popup` / `options_page` が Findmark の想定どおり設定されていることを確認する。

### 5. 起動ショートカットの定義
- ポップアップをキーボードショートカットで起動できるよう、`commands` に `_execute_action`（ポップアップを開く既定コマンド）を定義する（PRD 機能1「キーボードショートカットで起動」）。

## 受け入れ条件

### 権限構成
- [ ] `manifest.ts` の `permissions` が `bookmarks` / `storage` / `activeTab` / `favicon` の4つのみである
- [ ] `host_permissions` を要求していない
- [ ] `content_scripts` ブロックが存在しない
- [ ] `web_accessible_resources` が `*://*/*` へ広範公開していない（最小化または削除されている）
- [ ] `devtools_page` エントリが存在しない
- [ ] `commands` に `_execute_action` が定義され、起動用ショートカットが割り当てられている

### 動作
- [ ] `pnpm build` が成功し、`dist/manifest.json` に上記の権限・エントリが正しく反映される
- [ ] `pnpm type-check` / `pnpm lint` がエラーなく通る
- [ ] `dist/` を Chrome に読み込むと、拡張がエラーなくロードされ、ポップアップ（アイコンクリック）とオプションページが開く
- [ ] `chrome://extensions` の権限表示に「すべてのサイトのデータの読み取り/変更」相当の広範警告が出ない

## 成功指標
- 拡張の要求権限が4つに収まり、host permission 警告が出ない状態になる（プライバシー方針の技術的担保の第一歩）。
- 後続の作業単位（U4 BookmarkService 等）が chrome API を実際に呼び出せる前提が整う。

## スコープ外

以下はこのフェーズでは実装しません:

- ブックマーク操作・ファビコン取得の実処理（U4 / U7 で実装）
- Service Worker のクリーンアップ処理・カスタム `commands` の受信処理（U17 で実装）
- テスト基盤の整備（U2 で実装）
- `_locales` の翻訳内容の拡充・多言語対応の全UI適用（U18 で実装。`__MSG_extensionName__` 等の既存キーはそのまま利用）
- `pages/devtools`・`pages/devtools-panel`・`pages/content-runtime` のディレクトリ自体の削除やビルド対象からの除外（manifest から参照を外すことで未ロードにする。パッケージ削除は行わない）

## 未確定の論点（承認前に判断が必要）

- **`.gitignore` への `.steering/` 追加の是非**: [docs/repository-structure.md](../../docs/repository-structure.md) の TODO は「ステアリング運用前に `.steering/` を `.gitignore` へ追加」とするが、`.claude/commands/commit-steering.md` は `.steering/`（主に tasklist.md）を**コミット対象に含める**運用である。両者は矛盾する。本ステアリングでは、`commit-steering` 運用を優先し **`.steering/` は追跡対象のまま（gitignore しない）** とすることを推奨する。この場合、repository-structure.md 側の当該 TODO を後日修正する（別途ドキュメント更新として扱う）。

## 参照ドキュメント

- [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) - MVP開発フロー（作業単位 U1）
- [docs/product-requirements.md](../../docs/product-requirements.md) - 機能1 / 非機能要件「セキュリティ・プライバシー」
- [docs/architecture.md](../../docs/architecture.md) - 「セキュリティアーキテクチャ」「技術的制約 > 現状ギャップ」
- [docs/repository-structure.md](../../docs/repository-structure.md) - `chrome-extension/` の役割・現状ギャップ
