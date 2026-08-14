# タスクリスト — U18 release-prep

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

## フェーズ1: i18n 基盤（`packages/i18n`）

- [x] カタログ（`locales/`）を Findmark 用に再構成する
  - [x] `locales/ko/` を削除する（PRD の対応言語は ja / en）
  - [x] 未使用のボイラープレートキー（`toggleTheme` / `injectButton` / `greeting` / `hello`）を ja / en から削除する
  - [x] `commandOpenPopup`（manifest のコマンド説明）を ja / en に追加する
  - [x] Popup / Options の全UI文言キーを ja / en に追加する（フェーズ2・3で参照する分を先に定義）
- [x] 翻訳コア `lib/runtime.ts` を実装する
  - [x] `UiLocale` 型 / `CATALOGS`（ja・en の静的 import）
  - [x] `resolveUiLocale(setting?)`（設定値 > `chrome.i18n.getUILanguage()` > `ja`、例外時は `ja`）
  - [x] `createTranslator(locale)`（`$1` 位置置換・`placeholders` 展開・ja フォールバック・キー返却）
  - [x] `MessageKey` 型を ja カタログから導出してエクスポートする
- [x] React 連携 `lib/react.tsx` を実装する（**`lib/react.ts` + `createElement`** で実装: `packages/i18n` は tsc ビルドのみで JSX 構成を持たないため）
  - [x] `I18nProvider({ locale, children })`（translator を `useMemo`）
  - [x] `useI18n()`（Provider 外でも既定ロケールで動作しクラッシュしない）
  - [x] ~~`package.json` に `react` の peer/dev 依存を追加~~（不要: `packages/ui` と同じくルートの `react` を解決する既存構成に合わせた。型解決・ビルドとも確認済み）／エントリから re-export する
- [x] `packages/i18n` に vitest を導入する
  - [x] `vitest.config.ts` と `test` スクリプトを追加（`packages/shared` の設定に合わせる）
  - [x] `resolveUiLocale` のテスト（設定値優先 / `ja-JP` / `en-US` / 未知言語 / API 例外）
  - [x] `createTranslator` のテスト（位置置換 / placeholders / ja フォールバック / キー返却）
  - [x] ja・en のキー集合一致テスト
- [x] `pnpm -F @extension/i18n test` と全体 `pnpm type-check` が通ることを確認する（16件パス / i18n パッケージの type-check・ビルド成功。全体 type-check はフェーズ5でボイラープレートページ削除後に実施）

## フェーズ2: Popup の i18n 適用

- [x] ロケール供給を組み込む
  - [x] `Popup.tsx` で `settingsStore.get()` から locale を読み、`I18nProvider` で全体を包む（初期描画はブロックしない）
- [x] 純粋モデル関数を「キー + 置換値」方式へ変更する
  - [x] `pages/popup/src/lib/message.ts` に `LocalizedMessage` 型を定義する
  - [x] `resultMetaModel.buildResultMetaLabel` をキー返却へ変更し、テストを更新する
  - [x] `inlineEditModel.validateUrl` をキー返却へ変更し、テストを更新する
- [x] コンポーネントの文言をキー経由に置き換える
  - [x] `SearchHeader.tsx`（プレースホルダ / aria-label / 追加ボタン / title）
  - [x] `FolderTree.tsx` / `FolderTreeItem.tsx`（「すべて」/ 「さらに N 件…」/ 展開・折りたたみ / aria-label）
  - [x] `ResultList.tsx` / `ResultRow.tsx`（空状態 / 選択・編集・削除の title / 「＋別名」/ 別名編集）
  - [x] `AliasEditor.tsx`（プレースホルダ / aria-label / 操作ヒント / 再編集 title）
  - [x] `InlineEdit.tsx`（aria-label / 保存・キャンセル / 検証エラー表示）
  - [x] `MovePanel.tsx`（絞り込みプレースホルダ / 該当なし / 「現在の場所」/ aria-label）
  - [x] `AddCurrentPanel.tsx`（見出し / 登録済み / タイトル / 保存先フォルダ / 別名 / 削除 / 完了 / 該当なし / aria-label）
  - [x] `BulkActionBar.tsx`（N件選択中 / 移動 / 削除 / 選択解除）
  - [x] `Toast.tsx` / `DragGhost.tsx` / `PopupShell.tsx` / `Favicon.tsx` の残存文言
  - [x] `Popup.tsx` 本体（空状態ラベル / 「元に戻す」/ その他 aria-label）
- [x] hooks のユーザー可視文言をキー経由に置き換える
  - [x] `useRowActions.ts`（アンドゥ文言「「X」を削除しました」等 / エラー文言）
  - [x] `useAddCurrent.ts`（登録不可 / 登録失敗）
  - [x] `useSearch.ts` ほかで露出する文言（あれば）
- [x] Popup に日本語ハードコードが残っていないことを grep で確認する（`console.*`・コメントを除く）

## フェーズ3: Options の i18n 適用

- [x] `Options.tsx` にロケール供給と `I18nProvider` を組み込む（言語変更を即時反映するコールバックを持つ）
- [x] タブラベルと `aria-label` をキー経由にする
- [x] `ImportExportTab.tsx` の全文言をキー経由にする（結果表の行ラベル・エラー文含む）
- [x] `ConflictDialog.tsx` の全文言をキー経由にする
- [x] `TrashTab.tsx` の全文言をキー経由にする（空状態・件数・削除日時・エラー文含む）
- [x] `SettingsTab.tsx` の全文言をキー経由にする
  - [x] U17 のショートカット未割り当て案内（見出し・説明・コピー・コピー済み・aria-label）
  - [x] 保持日数セクション（「N日」の表現を含む）
  - [x] 表示言語セクション（保留文言「UIへの反映は今後のアップデートで対応予定です」を差し替える）
  - [x] 言語変更成功時にルートへ通知し、再読み込みなしで切り替わるようにする
- [x] Options に日本語ハードコードが残っていないことを grep で確認する（`console.*`・コメントを除く）

## フェーズ4: アイコンと manifest / パッケージメタ

- [x] `chrome-extension/public/icon.svg` を作成する（`docs/design/` のアクセントカラーに準拠）
- [x] `bash-scripts/generate_icons.mjs` を実装する（headless Chrome で PNG 化・`CHROME_BIN` 上書き可・未検出時は明示エラー）
- [x] アイコン PNG を生成する（16 / 32 / 48 / 128）
  - [x] 生成結果を目視確認する（透過・視認性）
  - [x] ボイラープレートの `icon-34.png` を削除する
- [x] `chrome-extension/manifest.ts` を是正する
  - [x] `icons` を 16/32/48/128 に更新
  - [x] `action.default_icon` をサイズマップに更新
  - [x] `browser_specific_settings` を削除
  - [x] `commands._execute_action.description` を `__MSG_commandOpenPopup__` に変更
- [x] ルート `package.json` のメタ情報を是正する（`name` / `description` / `version: 1.0.0` / `repository`）
- [x] `chrome-extension/package.json` 等でバージョン整合が壊れていないことを確認する（`pnpm update-version 1.0.0` で全 package.json を一括更新。manifest の `version` は `chrome-extension/package.json` を参照する）

## フェーズ5: 提出 zip のクリーンアップ

- [x] 未使用ページを削除する（`pages/devtools` / `pages/devtools-panel` / `pages/content-runtime`）
- [x] 対応する e2e spec を削除する（`page-devtools-panel.test.ts` / `page-content-runtime.test.ts`）
- [x] 未使用の `chrome-extension/public/content.css` を削除する
- [x] `pnpm install` を実行しワークスペース整合を確認する
- [x] `pnpm build` 後の `dist/` に削除したページが含まれないことを確認する

## フェーズ6: ストア提出物とプライバシーポリシー

- [x] `docs/store/listing-ja.md` を作成する（名称 / 短い説明 / 詳細説明 / カテゴリ / 権限 justification / 起動ショートカット未割り当ての注意）
- [x] `docs/store/listing-en.md` を作成する（ja と同一構成）
- [x] `docs/store/privacy-policy-ja.md` を作成する（データ収集なし・外部通信ゼロ・保存先・第三者提供なし）
- [x] `docs/store/privacy-policy-en.md` を作成する
- [x] `docs/store/screenshots.md` を作成する（1280×800 の5シナリオと撮影手順・前準備）
- [x] `favicon` 権限の警告表示有無を確認し記録する（**結論: 警告が表示される** —「アクセスしたウェブサイトのアイコンの読み取り」。公式 permissions list を出典として記録）
  - [x] Chrome 公式ドキュメントで `favicon` 権限の警告有無を確認する
  - [x] 実機での最終確認手順をチェックリストに残す
- [x] 外部通信ゼロを静的に確認する（`fetch` / `XMLHttpRequest` / `WebSocket` の grep 結果を記録）
- [x] `docs/store/README.md` を作成する（提出チェックリスト・完了済み / 人手が必要の区別・上記2つの確認結果）
- [x] 権限 justification が manifest の `permissions`（4つ）と1対1で一致することを確認する

## フェーズ7: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `pnpm test`
- [x] リントエラーがないことを確認
  - [x] `pnpm lint`
- [x] 型エラーがないことを確認
  - [x] `pnpm type-check`
- [x] ビルドが成功することを確認
  - [x] `pnpm build`
  - [x] `dist/_locales/{ja,en}/messages.json` が出力されていることを確認
  - [x] `dist/manifest.json` の `icons` / `permissions` / `commands` が意図通りであることを確認
- [x] `pnpm zip` が成功し、zip の中身が manifest の宣言と一致することを確認

## フェーズ8: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.md の AC-1〜AC-4）と実装を突き合わせ OK/NG を一覧化
- [x] `implementation-validator` の指摘に対応（総合5/5・ブロッカーなし。指摘1「Options のエラー文言が翻訳済み文字列で state 保持され、表示中の言語切替に追従しない」を修正＝`MessageKey` 保持へ統一。指摘2「`.github/workflows/e2e-modular.yml` がボイラープレート由来で実質無効」は本単位のスコープ外のため、受け入れ承認時にユーザーへ後続対応を提案する）
- [x] ユーザーに検証を依頼
- [x] 受け入れ承認（ゲート2）を取得（2026-08-14）
  - NGがあった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ9: ドキュメント更新・振り返り（モード4）

- [x] `docs/product-requirements.md`「リリース準備タスク」のチェックボックスを実態に合わせて更新（あわせて「権限の警告表示」節を追加）
- [x] `docs/repository-structure.md` に `docs/store/` と未使用ページ削除を反映（`packages/i18n` の節も新設）
- [x] `docs/mvp-development-flow.md` の「進捗」表と Definition of Done を更新
- [x] ~~`README.md` を更新~~（本単位では不要: ルート README はボイラープレート由来の英語 README で、ストア提出物とは独立。全面刷新は別作業として起票する方が適切と判断した）
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

**ユーザーによる受け入れ検証での差し戻し: なし（ラウンド0）。**

`implementation-validator`（ステップ6）の指摘に対する自己修正のみ:

- ラウンド0-a（2026-08-14・ゲート2提示前）
  - 不一致内容: Options の3タブがエラー文言を**翻訳済み文字列**のまま state に保持しており、表示中に「表示言語」を切り替えても再翻訳されない（AC-1「再読み込みなしで切り替わる」と厳密には不整合）
  - 分類: A（実装欠陥。計画どおりの「キー保持」方針から外れていた）
  - 戻り先: モード2（`SettingsTab.tsx` / `TrashTab.tsx` / `ImportExportTab.tsx`）
  - 対応: `error: string | null` を `errorKey: MessageKey | null` に変更し、描画時に `t(errorKey)` する方式へ統一。`InlineEdit.tsx` の `urlError` と同じパターンに揃えた。test / lint / type-check / build を再実行して全パス

---

## 実装後の振り返り

### 実装完了日
2026-08-14

### 計画と実績の差分

**計画と異なった点**:
- `packages/i18n` の React 連携を `lib/react.tsx`（JSX）ではなく **`lib/react.ts` + `createElement`** で実装した。`packages/i18n` は `tsc -b` だけでビルドされる薄いパッケージで、JSX 構成を持ち込むと tsconfig/ビルド設定の変更が必要になるため。Provider は要素を1つ返すだけなので JSX の可読性メリットが小さい。
- `react` を `packages/i18n` の依存に**追加しなかった**。`packages/ui` が同じくルートの `react` を解決している既存構成に合わせた（型解決・ビルド・テストで確認済み）。
- アイコンの生成元 SVG を `chrome-extension/public/` ではなく **`chrome-extension/icons/`** に置いた。`public/` は dist へ丸ごとコピーされるため、manifest が参照しない SVG が提出 zip に混入してしまう（実際に1度混入したのを検知して移動した）。
- モデル層の戻り値方針を「キー + 置換値（`LocalizedMessage`）」で統一した。`resultMetaModel` は `allScopeLabel`（翻訳済みの「すべて」）を**入力として受け取る**形にし、モデルがロケールを一切知らない状態を保った。

**新たに必要になったタスク**:
- Options のエラー state を `MessageKey` 保持へ変更（検証ログ ラウンド0-a）。計画時は「表示中の文言がロケール変更に追従するか」まで詰めていなかった。
- `favicon` 権限の警告有無の調査結果が想定と逆だった（「警告なし」を漠然と想定していたが、**実際は「アクセスしたウェブサイトのアイコンの読み取り」が表示される**）。掲載文・プライバシーポリシー・PRD への反映が追加で必要になった。

**技術的理由でスキップしたタスク**:
- `README.md` の更新: ルート README はボイラープレート由来（英語・上流リポジトリのバッジ/Discord リンク）で、ストア提出物とは独立している。U18 の受け入れ基準に含まれず、全面刷新は独立した作業として扱う方が適切と判断した。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 0（ユーザー検証での差し戻しなし）／ `implementation-validator` 指摘による自己修正 1件（分類A）
- 主な不一致と分類: A（実装欠陥）1件 — Options のエラー文言がロケール切替に追従しない
- 受け入れ承認: 2026-08-14 取得

### 学んだこと

**技術的な学び**:
- **`chrome.i18n.getMessage` はブラウザ UI 言語しか見ない**。アプリ内に言語切替設定を持つ拡張では、`_locales` だけでは要件を満たせず、同じカタログをバンドルして自前で引くランタイム層が要る。逆に manifest の文言は `_locales` でしか国際化できないため、**カタログを1つにして2系統へ供給する**構成が二重管理を避ける唯一の解になった。
- TypeScript は `resolveJsonModule` で import した JSON を `outDir` へ emit する。この性質のおかげで、追加のコピー処理なしに `dist/locales/{ja,en}` が揃った。
- 「文言を返す純粋関数」は文言変更のたびにテストが壊れる。**キー + 置換値を返す**形にすると、テストがロジック（どのキーを・どの値で選ぶか）だけを検証するようになり、i18n 化そのものがテストの質を上げた。
- `public/` の中身は無条件で成果物に入る。提出物のクリーンさは「manifest が宣言していないものが dist に無いか」を zip の中身で直接確認するのが確実だった。

**プロセス上の改善点**:
- 承認ゲート1で「計画に含めた追加スコープ（zip クリーンアップ・バージョン 1.0.0・スクリーンショットを人手に残すこと）」を明示して合意を取ったため、実装中に判断を戻す必要がなかった。
- 一方、`.github/workflows/e2e-modular.yml`（ボイラープレート由来で実質無効）は検証段階で初めて表面化した。**「削除したものを参照している箇所」はソースだけでなく CI 定義まで含めて洗う**べきだった。

### 次回への改善提案
- 文言を state に持つ箇所（トースト・エラー）は、実装時に「表示中にロケールが変わったらどうなるか」を必ず自問する。今回は Options を修正し、Popup のトーストは一時表示のため確定文字列で持つ判断を**コメントに残した**。この種の意図的な非対称はコメントで明示する運用を続ける。
- リリース準備単位では、外部仕様（今回は Chrome の権限警告一覧）を**思い込みで書かず必ず一次情報を引く**。想定と逆の結果が出た実例になった。
- 残タスク（人手）: スクリーンショット5枚の撮影、プライバシーポリシーの公開 URL 用意、デベロッパー登録、実機での権限警告の最終確認。すべて `docs/store/README.md` のチェックリストに集約済み。
- 後続候補: `.github/workflows/e2e-modular.yml`（と Firefox 前提の e2e 設定）の整理、ルート `README.md` の Findmark 向け刷新。
