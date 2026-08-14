# Chrome Web Store 提出チェックリスト

- **ドキュメント名**: store/README
- **対象**: Findmark 1.0.0（初回提出）
- **作成**: 2026-08-14（U18 release-prep）

このディレクトリは Chrome Web Store への提出物をまとめたもの。

| ファイル | 内容 |
|---|---|
| [listing-ja.md](./listing-ja.md) / [listing-en.md](./listing-en.md) | 掲載情報（名称・説明・カテゴリ・権限の理由） |
| [privacy-policy-ja.md](./privacy-policy-ja.md) / [privacy-policy-en.md](./privacy-policy-en.md) | プライバシーポリシー（データ収集なしの宣言） |
| [screenshots.md](./screenshots.md) | スクリーンショットの撮影シナリオと手順 |

---

## 1. リポジトリ側で完了している項目

| 項目 | 状態 | 実体 |
|---|---|---|
| アイコン（16 / 32 / 48 / 128） | ✅ 完了 | `chrome-extension/public/icon-*.png`（生成元 `chrome-extension/icons/icon.svg`・再生成は `node bash-scripts/generate_icons.mjs`） |
| manifest の最小権限 | ✅ 完了 | `bookmarks` / `storage` / `activeTab` / `favicon` の4つのみ・host permission なし |
| 多言語対応（`_locales` ja/en） | ✅ 完了 | `packages/i18n/locales/{ja,en}/messages.json` → ビルドで `dist/_locales/` へ出力 |
| バージョン | ✅ 完了 | `1.0.0`（`pnpm update-version <x.y.z>` で全 package.json を一括更新） |
| ストア説明文（ja / en） | ✅ 完了 | listing-ja.md / listing-en.md |
| プライバシーポリシー（ja / en） | ✅ 完了 | privacy-policy-ja.md / privacy-policy-en.md |
| 提出 zip に不要ファイルを含めない | ✅ 完了 | 未使用のボイラープレートページ（devtools / devtools-panel / content-runtime）と `content.css` を削除済み |
| 起動ショートカット未割り当ての案内 | ✅ 完了 | Options「設定」タブ（U17）+ 掲載文への記載（listing の「起動ショートカットについて」） |

## 2. 人手が必要な項目（リリース実務）

| 項目 | 内容 |
|---|---|
| Chrome Web Store デベロッパー登録 | 初回のみ $5 の登録料。Google アカウントで登録する |
| スクリーンショット5枚の撮影 | [screenshots.md](./screenshots.md) の手順に従う（実機で拡張を読み込んだ画面が必要） |
| プライバシーポリシーの公開 URL | privacy-policy-*.md を公開できる場所（GitHub Pages / リポジトリの Raw URL 等）に配置し、掲載情報へ URL を入力する |
| 提出用 zip の作成 | `pnpm zip`（`dist-zip/` に出力される） |
| 実機での権限警告の確認 | 下記「3. `favicon` 権限の警告」の実機確認手順 |
| ストアの各タブ入力 | listing-*.md の内容を「ストアの掲載情報」「プライバシーへの取り組み」タブへ転記する |

## 3. `favicon` 権限の警告表示（PRD「リリース準備タスク」の確認事項）

**結論: `favicon` 権限はインストール時に警告が表示される。**

- 出典: Chrome for Developers「Declare permissions（permissions list）」
  https://developer.chrome.com/docs/extensions/reference/permissions-list
  - `"favicon"`: *Grants access to the Favicon API.* **Warning displayed: “Read the icons of the websites you visit.”**
  - `"bookmarks"`: *Gives access to the chrome.bookmarks API.* **Warning displayed: “Read and change your bookmarks.”**
  - `"storage"`: 警告なし
  - `"activeTab"`: 警告なし（ユーザー操作時に一時的なアクセスを得る）
- 確認日: 2026-08-14

したがって Findmark のインストール時にユーザーが見る警告は次の2つになる。

1. ブックマークの読み取りと変更
2. アクセスしたウェブサイトのアイコンの読み取り

**対応**: 掲載情報の詳細説明とプライバシーポリシーの双方で、この2つが何のために必要かを明示する（「ページの内容や閲覧履歴にはアクセスしない」ことを併記する）。listing-ja.md / listing-en.md の「権限について」節が該当。

**実機での最終確認手順**（提出前に1回だけ行う）:

1. `pnpm build` → `chrome://extensions` で「パッケージ化されていない拡張機能を読み込む」
2. 表示される権限ダイアログ（または拡張機能カードの「詳細 > 権限」）に、上記2件**以外**の警告が出ていないことを確認する
3. 想定外の警告が出た場合は manifest の `permissions` を見直す（host permission の混入を疑う）

## 4. 外部通信ゼロの確認（PRD 非機能要件）

**結論: 製品ビルドに外部通信は存在しない。** 確認日 2026-08-14 / 対象 `dist/`（`pnpm build` の成果物）。

| 確認 | 方法 | 結果 |
|---|---|---|
| ソース | `pages` / `packages` / `chrome-extension/src` を `fetch(` / `XMLHttpRequest` / `WebSocket` で grep | 該当は `packages/hmr`（開発時のホットリロード専用）のみ。同パッケージは製品ビルドに含まれない（`refresh.js` の注入は `IS_DEV` 時のみ） |
| 製品バンドル | `dist/popup/assets/*.js` / `dist/options/assets/*.js` / `dist/background.js` を grep | `XMLHttpRequest` / `WebSocket` は 0 件。`fetch(` は Vite の modulepreload polyfill（`fetch(link.href)` = 拡張内の同一オリジン資源の先読み）のみ |
| 外部 URL | 同バンドルを `https?://` で grep | SVG/XML の名前空間 URL、React のエラー案内 URL、JSDoc の例（`https://ex.com/...`）のみ。通信を伴う参照はなし |
| フォント | `@fontsource/*` を同梱し `@font-face` で適用（U7） | CDN 参照なし |
| ファビコン | `chrome.runtime.getURL('/_favicon/...')`（`favicon` 権限） | Chrome がローカルに保持するアイコンを参照するのみ |

## 5. 提出前の最終ゲート

- [ ] `pnpm test` / `pnpm lint` / `pnpm type-check` がすべて成功する
- [ ] `pnpm build` が成功し、`dist/manifest.json` の `version` が提出予定のバージョンと一致する
- [ ] `dist/_locales/ja` と `dist/_locales/en` の両方が出力されている
- [ ] `pnpm zip` で生成した zip に、manifest が参照しないページが含まれていない
- [ ] スクリーンショット5枚が揃っている
- [ ] プライバシーポリシーが公開 URL で参照できる
- [ ] 実機の権限警告が「ブックマークの読み取りと変更」「サイトのアイコンの読み取り」の2件のみである
