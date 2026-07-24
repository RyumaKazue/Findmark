# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース
以下の技術的理由に該当する場合のみスキップ可能:
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:
```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

---

## フェーズ1: manifest.ts の是正

- [x] `permissions` を `['bookmarks', 'storage', 'activeTab', 'favicon']` に更新する
- [x] `content_scripts` ブロックを削除する
- [x] `devtools_page` エントリを削除する
- [x] `web_accessible_resources` を削除する（`pnpm build`/`pnpm dev` が破綻する場合は最小パターン `['_favicon/*']` 等へ縮小にフォールバックし、その旨を注記）
- [x] `commands._execute_action`（`suggested_key`: 既定 `Ctrl+Shift+F` / mac `Command+Shift+F`、description 付き）を追加する
- [x] `action.default_popup` が `popup/index.html`、`options_page` が `options/index.html` であることを確認する
- [x] `satisfies ManifestType` の型制約を満たすことを確認する（型チェックで検証。フェーズ3で確認）

## フェーズ2: `.gitignore` の扱い（承認結果に依存）

- [x] `.steering/` を gitignore するか否かのユーザー判断を反映する
  - **判断結果: gitignore しない（git 追跡のまま）** — ユーザー承認済み。`.gitignore` は変更しない。
  - 申し送り: repository-structure.md「除外設定」の TODO（`.steering/` を `.gitignore` へ追加）は commit-steering 運用と矛盾するため、後日「不要（追跡する方針）」へ修正する。

## フェーズ3: 品質チェックと検証

- [x] 型チェックが通ることを確認する
  - [x] `pnpm type-check`（`chrome-extension` パッケージは通過。`commands` は `ManifestType` に受理される。※ `packages/ui` 由来の `@/lib/utils` 等の解決エラーは変更退避後も再現する**既存負債**で U1 対象外。別途 U2 基盤整備で対応する申し送り）
- [x] リントエラーがないことを確認する
  - [x] `pnpm lint`（`chrome-extension` パッケージ: エラーなし）
- [x] ビルドが成功することを確認する
  - [x] `pnpm build`（16/16 タスク成功。`web_accessible_resources` 削除でも破綻なし）
- [x] `dist/manifest.json` を確認する
  - [x] `permissions` が4つ（bookmarks/storage/activeTab/favicon）のみ
  - [x] `content_scripts` が存在しない
  - [x] `devtools_page` が存在しない
  - [x] `web_accessible_resources` が広範公開（`*://*/*`）でない（キー自体が不在）
  - [x] `commands._execute_action` が存在する
- [x] Chrome に `dist/` を読み込んで動作を確認する（手動・モード3のユーザー検証で実施）
  - [x] 拡張がエラーなくロードされる
  - [x] `chrome://extensions` に「すべてのサイトのデータ読み取り/変更」相当の広範警告が出ない
  - [x] アイコンクリックでポップアップが開く
  - [x] オプションページが開く
  - 既知事項（U1スコープ外）: ボイラープレートのデモPopup(`pages/popup/src/Popup.tsx`)の「inject content script」ボタンは `tab.url!` の非null断定で TypeError を出す。activeTab が chrome:// にアクセス権を付与しない仕様に起因。Findmark 設計と無関係のデモコードのため **U7 (popup-search-shell) でPopupを検索UIに置換して解消**する。ユーザー承認により U1 はこのまま受け入れ。

> 注: 本作業単位はロジックを持たないため `pnpm test` は対象外（テスト基盤は U2 で整備）。
> 注: 全体の `pnpm type-check` は `packages/ui` の既存エラーで失敗するが、これは U1 の変更起因ではない（manifest.ts 退避後も再現）。U1 の型健全性は `chrome-extension` パッケージ単体の通過で担保する。

## フェーズ4: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.mdの各要件）と実装を突き合わせOK/NGを一覧化
- [x] ユーザーに検証を依頼
- [x] 受け入れ承認（ゲート2）を取得（2026-07-24 承認取得）
  - NGがあった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ5: ドキュメント更新・振り返り（モード4）

- [x] `docs/mvp-development-flow.md` の進捗表で U1 を「完了」に更新
- [x] `.gitignore` の判断結果に応じ、repository-structure.md の TODO 修正要否を申し送り（下記振り返りに記録）
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

- ラウンド1（2026-07-24）
  - 不一致内容: 実機ロード後、ポップアップの「inject content script」ボタン押下で `Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'startsWith')`
  - 分類: **U1スコープ外の既存デモコード**（A/B/C いずれの手戻りにも該当せず）。原因は `pages/popup/src/Popup.tsx` のボイラープレートデモ（`tab.url!` 非null断定 / activeTab は chrome:// に権限付与しない）。manifest.ts（U1成果物）は正しく、受け入れ基準は充足。
  - 戻り先: なし（U1は手戻りせず）。恒久対応は **U7 (popup-search-shell)** でPopupを検索UIへ置換して解消。
  - 対応: ユーザー承認により U1 を受け入れ。デモPopupは U7 で置換する方針を確認。

---

## 実装後の振り返り

### 実装完了日
2026-07-24

### 計画と実績の差分

**計画と異なった点**:
- `web_accessible_resources` は「破綻時は最小パターンへ縮小」とフォールバックを用意していたが、**完全削除でも `pnpm build`（16/16）が成功**したため、削除で確定した。
- 品質チェックは全体 `pnpm type-check` が `packages/ui` の既存エラー（`@/lib/utils` 等のパス解決）で失敗するため、U1 の型健全性は **`chrome-extension` パッケージ単体の通過**で担保する形に調整した（この既存負債は U2 で是正する申し送り）。

**新たに必要になったタスク**:
- 特になし（既存負債・デモPopupエラーはいずれも U2 / U7 への申し送りで処理）。

**技術的理由でスキップしたタスク**（該当する場合のみ）:
- なし。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 1（ただし U1 は手戻りせず。U7 への申し送りで解決）
- 主な不一致と分類: デモPopupの `startsWith` TypeError = U1スコープ外の既存デモコード（manifest は正しい）
- 受け入れ承認: 2026-07-24 取得

### 学んだこと

**技術的な学び**:
- `favicon` 権限による `_favicon/` は拡張自身のページから参照でき、`web_accessible_resources` を必要としない。露出面最小化のため削除で問題ない。
- `activeTab` は chrome:// ページには権限を付与しないため、`tab.url` が undefined になり得る。UIで `tab.url` を扱う際は非null断定（`!`）を避け、存在チェックを入れるべき（U7 実装時の注意点）。

**プロセス上の改善点**:
- 未コミットの untracked ファイル（`docs/mvp-development-flow.md`）が作業中に消失した。**作業単位の区切りで `/commit-steering` により早めにコミットし、成果物を追跡下に置く**ことを徹底する。

### 次回への改善提案
- U2（test-infrastructure）で、`packages/ui` の型解決エラーの是正と `pnpm test` 基盤の整備を最優先で行う（以降の全単位の品質ゲート前提）。
- U7（popup-search-shell）実装時、ボイラープレートの `Popup.tsx`（デモの inject ボタン含む）を全面置換し、`tab.url` の存在チェックを入れる。
- 各単位完了ごとに `/commit-steering [作業単位名]` でコミットして untracked のまま放置しない。
