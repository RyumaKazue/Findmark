# 要求内容 — U18 release-prep

## 概要

MVP最終単位として、Findmark を **Chrome Web Store へ提出できる状態**にする。具体的には (1) Popup / Options の全UI文言を `_locales`(ja既定 / en) ベースの i18n へ移行し、Options の「表示言語」設定を実際に機能させる、(2) 拡張アイコンを Findmark 固有のものに差し替える、(3) ストア提出物（説明文 ja/en・スクリーンショット手順・プライバシーポリシー・提出チェックリスト）を整備する、(4) manifest / パッケージメタと提出 zip の中身をリリース品質へ是正する。

## 背景

- `docs/mvp-development-flow.md` の作業単位 **U18 release-prep**（依存 U7〜U17・U19 はすべて完了）。本書の受け入れ基準は同表から写した。
- PRD「リリース準備タスク」([product-requirements.md L483-491](../../docs/product-requirements.md)) が未消化のまま残っている（アイコン / スクリーンショット / ストア説明文 / `_locales` / プライバシーポリシー / `favicon` 権限警告の確認）。
- PRD「互換性 / 国際化」: `_locales` による多言語対応（日本語 / 英語）、既定ロケールは `ja`。
- U16 で `UserSettings.locale`(ja|en) の保存だけを実装し、`pages/options/src/components/SettingsTab.tsx` に「UI 文言への実適用（i18n）は U18（release-prep）で扱う」と明記して先送りしていた。現状の「表示言語」設定は**保存されるが何も変わらない**ため、このまま出すとリリース品質を満たさない。
- U17 で追加した Options のショートカット未割り当て案内は日本語ハードコードであり、mvp-development-flow の U18 行が「**U17 で追加した Options のショートカット案内文を含む**」と明示している。
- PRD「起動ショートカットの割り当て」の注記（2026-08-14）に「ストア公開時の説明文にも同趣旨の記載を検討する(U18)」とある。
- 現状の `chrome-extension/manifest.ts` はアイコンがボイラープレートのままで、Firefox 用 `browser_specific_settings`(`example@example.com`) が残存する。ビルド成果物 `dist/` にも manifest が宣言していない `devtools/` `devtools-panel/` `content-runtime/` が含まれ、提出 zip に不要ファイルが同梱される。

## 実装対象の機能

### 1. i18n 基盤（`packages/i18n`）

- `locales/{ja,en}/messages.json` を Findmark のUI文言カタログとして再構成する（`_locales` の正）。
- PRD の対応言語（ja / en）に合わせ `locales/ko` を削除、未使用のボイラープレートキー（`toggleTheme` / `injectButton` / `greeting` / `hello`）を削除する。
- ロケール解決と文言展開を行う **React 非依存の翻訳コア**を追加する。
  - `resolveUiLocale(setting?: 'ja'|'en')`: 設定値を優先し、未指定時は `chrome.i18n.getUILanguage()` から `ja` / `en` を導出（`ja` 始まりなら `ja`、それ以外は `en`）。
  - `createTranslator(locale)`: `$1` 位置置換・`$NAME$` プレースホルダ置換に対応。キー欠落時は既定ロケール(ja) → キー文字列の順にフォールバックし、例外を投げない。
- React 側から使うための `I18nProvider` / `useI18n()`（`t` を返す）を提供する。
- `chrome.i18n.getMessage` は**ブラウザUI言語しか見ない**ためユーザー設定を反映できない。本単位のランタイム翻訳はバンドル済みカタログを直接引く方式とし、`_locales` は manifest の `__MSG_*`（拡張名 / 説明 / コマンド説明）に使う。

### 2. Popup の全UI i18n 適用

- `pages/popup/src/` のユーザー可視文言（ラベル・プレースホルダ・`aria-label` / `title`・空状態・トースト / アンドゥ文言・インライン編集のエラー文）をすべてメッセージキー経由にする。
- 純粋モデル関数（`resultMetaModel` / `inlineEditModel` など）は翻訳済み文字列を返さず、**メッセージキー + 置換値**を返す構造に変える（表示直前にUI層が翻訳する）。既存ユニットテストはキー検証へ更新する。
- 開発者向け `console.*` のログ文言は i18n 対象外（ユーザーに見えないため）。

### 3. Options の全UI i18n 適用

- タブラベル / インポート・エクスポート / ゴミ箱 / 設定の全文言をキー経由にする（**U17 のショートカット未割り当て案内文を含む**）。
- 「表示言語」設定の変更が **即時にUI全体へ反映**されるようにし、「UIへの反映は今後のアップデートで対応予定です」という保留文言を差し替える。

### 4. アイコンと manifest / パッケージメタの是正

- Findmark 固有のアイコンを 16 / 32 / 48 / 128 px の PNG で用意し、`icons` と `action.default_icon` に登録する（生成元 SVG と生成スクリプトをリポジトリに残す）。
- `browser_specific_settings`（Firefox 用 gecko id）を削除する（MVP は Chrome 専用: mvp-development-flow「スコープ外」）。
- `commands._execute_action.description` を `__MSG_*` 化する。
- ルート `package.json` の `name` / `description` / `version` / `repository` をボイラープレートから Findmark のリリース値へ是正する（初回提出バージョン `1.0.0`）。

### 5. 提出 zip のクリーンアップ

- manifest が宣言していない未使用ページ（`pages/devtools` / `pages/devtools-panel` / `pages/content-runtime`）と、それに対応する e2e spec・未使用の `content.css` を削除し、ビルド成果物を manifest の宣言内容と一致させる。

### 6. ストア提出物とプライバシーポリシー

- `docs/store/` を新設し、以下を作成する。
  - `listing-ja.md` / `listing-en.md`: 拡張名・短い説明・詳細説明・カテゴリ・権限ごとの justification。**起動ショートカットが未割り当てになりうる旨と対処**を記載する（PRD 注記）。
  - `privacy-policy-ja.md` / `privacy-policy-en.md`: データ収集なしの宣言（外部通信ゼロ・host permission なし・保存先は `chrome.storage` のみ）。
  - `screenshots.md`: 1280×800 スクリーンショットの撮影シナリオと手順（実際の撮影はリリース実務として人手で行う）。
  - `README.md`: 提出チェックリスト（デベロッパー登録・zip・権限説明・プライバシー設定の申告内容）と **`favicon` 権限の警告表示有無の確認結果**。

## 受け入れ条件

> 出典: `docs/mvp-development-flow.md` 作業単位一覧 U18 の受け入れ基準
> 「全UIがi18n化 / ストア提出物が揃う / 権限説明とプライバシーポリシー整合」

### AC-1: 全UIが i18n 化されている

- [ ] `pages/popup/src` / `pages/options/src` のユーザー可視文言に、日本語ハードコード文字列が残っていない（`console.*` とコードコメントを除く）
- [ ] `locales/ja/messages.json` と `locales/en/messages.json` のキー集合が完全一致する（自動テストで担保）
- [ ] 既定ロケールが `ja` で、`locale` 未設定かつブラウザUI言語が日本語以外のとき英語UIになる
- [ ] Options の「表示言語」を `en` / `ja` に切り替えると、再読み込みなしで Options のUI文言が切り替わる
- [ ] 同じ設定が Popup にも反映される（Popup を開き直すと選択言語で表示される）
- [ ] U17 のショートカット未割り当て案内（見出し・説明・コピー操作の文言）が ja / en 双方に存在する
- [ ] メッセージキーが欠落しても例外を投げず、既定ロケール → キー文字列の順にフォールバックする（ユニットテストで担保）

### AC-2: ストア提出物が揃う

- [ ] アイコンが Findmark 固有のものに差し替わり、16 / 32 / 48 / 128 px が manifest から参照されている
- [ ] `docs/store/listing-ja.md` / `listing-en.md` に拡張名・短い説明・詳細説明・カテゴリ・権限 justification が揃っている
- [ ] ストア説明文に「起動ショートカットが未割り当てになりうる／`chrome://extensions/shortcuts` で設定できる」旨が ja / en 双方に記載されている
- [ ] `docs/store/screenshots.md` に 1280×800 の撮影シナリオ（Popup 主要状態 + Options）と撮影手順が定義されている
- [ ] `docs/store/README.md` に提出チェックリストがあり、リリース実務（人手）で行う項目と完了済み項目が区別されている
- [ ] `pnpm build` と `pnpm zip` が成功し、生成 zip に manifest 未宣言のページ（devtools / devtools-panel / content-runtime）が含まれない

### AC-3: 権限説明とプライバシーポリシーが整合する

- [ ] プライバシーポリシー(ja/en)に「データ収集なし・外部通信ゼロ・host permission なし」が明記され、保存先が `chrome.storage`(sync/local) のみであることが書かれている
- [ ] ストア説明文の権限 justification が manifest の `permissions`（`bookmarks` / `storage` / `activeTab` / `favicon` の4つ）と過不足なく一致する
- [ ] `favicon` 権限のインストール時警告の有無を確認し、結果と根拠（確認方法・出典）が `docs/store/README.md` に記録されている
- [ ] ソースに `fetch` / `XMLHttpRequest` / `WebSocket` による外部通信が存在しないことを確認した結果が記録されている（PRD 非機能要件「外部通信ゼロ」）

### AC-4: 品質ゲート

- [ ] `pnpm test` / `pnpm lint` / `pnpm type-check` がすべて成功する
- [ ] `pnpm build` が成功し、`dist/_locales/{ja,en}/messages.json` が出力される

## 成功指標

- Chrome Web Store の提出フォームを、追加の設計判断なしに（画像の実撮影とデベロッパー登録を除いて）埋めきれる状態になる
- 日本語話者・英語話者のどちらが使っても、UI に未翻訳の文言が露出しない

## スコープ外

- スクリーンショット画像そのものの撮影（実機で拡張をロードした画面の取得が必要なため、手順書の整備までを本単位の範囲とし、撮影はリリース実務で人手が行う）
- Chrome Web Store デベロッパー登録（$5 の支払いを伴う外部手続き）と実際の提出操作
- ja / en 以外の言語追加（PRD の対応言語は ja / en）
- Firefox 対応（MVP は Chrome 専用）
- E2E テストの新規追加（既存の主要導線 spec を維持する範囲にとどめる）
- 検索ロジック・UI 挙動の変更（本単位は文言・メタデータ・提出物のみを扱う）

## 参照ドキュメント

- [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) — 作業単位 U18（受け入れ基準の出典）
- [docs/product-requirements.md](../../docs/product-requirements.md) — 「互換性 / 国際化」「セキュリティ / プライバシー」「起動ショートカットの割り当て」「リリース準備タスク」
- [docs/functional-design.md](../../docs/functional-design.md) — UI設計（文言の対象となるコンポーネント）
- [docs/architecture.md](../../docs/architecture.md) — セキュリティ制約（外部通信ゼロ・最小権限）
- [docs/repository-structure.md](../../docs/repository-structure.md) — `packages/i18n`（`_locales`(ja/en)の型付き参照）・`packages/zipper`（ストア提出用zip生成）
- [docs/development-guidelines.md](../../docs/development-guidelines.md) — コーディング規約・レイヤー依存
