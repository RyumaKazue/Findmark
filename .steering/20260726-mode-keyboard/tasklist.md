# タスクリスト — U8 mode-keyboard

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:
```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

---

## フェーズ1: モードマシン（純粋ロジック）

- [x] `pages/popup/src/hooks/modeMachine.ts` を新規作成
  - [x] `Mode` 型（LIST/INLINE_EDIT/ALIAS_EDIT/DRAG/PANEL）・`ModeState`・`initialModeState`
  - [x] `ModeAction` と `modeReducer`（ENTER_* / EXIT_TO_LIST、不正遷移は現状維持）
  - [x] `KeyIntent` 型と `resolveKeyIntent(mode, e)`（全5モードの ↑↓/Enter/Escape を定義通りに解決）
  - [x] `resolveListEscape(ctx)`（clear-keyword → clear-scope → close の段階解決）
  - [x] `isPrintableKey(e)`（修飾キー付き・機能キー・IME 変換中を除外）
  - [x] `SHORTCUTS` 定数 と `resolveShortcutIntent(e)`（F2/Ctrl+E→inline-edit, Ctrl+;→alias-edit, Ctrl+M→panel）

## フェーズ2: モードマシンのユニットテスト

- [x] `pages/popup/src/hooks/modeMachine.test.ts` を新規作成
  - [x] `modeReducer`: 各 ENTER_* の遷移と targetId、EXIT_TO_LIST の復帰、LIST での EXIT/二重遷移の安全性
  - [x] `resolveKeyIntent`: 全5モード × ↑↓/Enter/Escape の網羅（DRAG は Escape 以外 none、INLINE_EDIT の ↑↓ は none）
  - [x] `resolveListEscape`: query/scope の4組合せ
  - [x] `isPrintableKey`: 'a'/'あ'=true、Ctrl/Meta/Alt+a=false、Enter/Arrow/Tab/Escape=false、isComposing=false
  - [x] `resolveShortcutIntent`: F2/Ctrl+E/Ctrl+;/Ctrl+M と無関係キー(null)

## フェーズ3: useMode フック

- [x] `pages/popup/src/hooks/useMode.ts` を新規作成
  - [x] `useReducer(modeReducer, initialModeState)` でモード state を保持
  - [x] 遷移 API（enterInlineEdit/enterAliasEdit/enterPanel/enterDrag/exitToList）を useCallback で公開
  - [x] `resolveKey(e)`（現在モードに束ねた resolveKeyIntent）を公開

## フェーズ4: Popup / SearchHeader への結線

- [x] `SearchHeader.tsx` 変更
  - [x] キー処理を親へ委譲する `onKeyDown` prop に統一（自前のキー意味論を撤去。Escape も親で解決）
  - [x] 検索ファースト用に `inputRef` を親から受け取り、起動時フォーカスにも使用
  - [x] IME 変換中の Enter/Escape は親（Popup）の `nativeEvent.isComposing` ガードで無視
- [x] `Popup.tsx` 変更
  - [x] `useMode()` を導入
  - [x] LIST の ↑↓/Enter を `useMode.resolveKey` のインテント実行に置換
  - [x] 段階 Escape を `resolveListEscape({ hasQuery, hasScope })` で実行（clear-keyword/clear-scope/close）
  - [x] 検索ファースト復帰をルート onKeyDown に配線（編集モード以外 & isPrintableKey で inputRef.focus）
  - [x] 既存の selectedIndex クランプ・追従スクロール・フォルダ選択の回帰がないことを確認

## フェーズ5: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `pnpm test`（popup 40 passed / 全体 12 tasks successful）
- [x] リントエラーがないことを確認
  - [x] `pnpm lint`（exit 0）
- [x] 型エラーがないことを確認
  - [x] `pnpm type-check`（exit 0）

## フェーズ6: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.md の各要件）と実装を突き合わせ OK/NG を一覧化
- [x] implementation-validator サブエージェントで品質検証
- [x] ユーザーに検証を依頼し、受け入れ承認（ゲート2）を取得（2026-07-27）
  - NG があった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ7: ドキュメント更新・振り返り（モード4）

- [x] 必要に応じて `docs/` の永続ドキュメントを更新（本単位の挙動は functional-design「画面遷移図/モード別のキー挙動/共通ルール」に準拠。キー方式の precedence 判断も steering design.md に記録済みのため、永続ドキュメントの改訂は不要と判断）
- [x] `docs/mvp-development-flow.md` の進捗表を U8 完了に更新
- [x] 実装後の振り返り（このファイル下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

- ラウンド1（2026-07-26）
  - 不一致内容: implementation-validator が (1) `useMode.ts` の JSDoc に含まれる `*/` がコメントを誤終端し type-check/lint/build が失敗、(2) `modeMachine.ts` の inline export が `import-x/exports-last` 規約違反、(3) `PopupShell` の静的 `<div>` への `onKeyDown` が `jsx-a11y/no-static-element-interactions` 違反、(4) `Popup.tsx` の Prettier 未整形、(5)【推奨】LIST のキー操作が検索ボックスフォーカス時のみ有効（フォルダボタンクリック後に ↑↓/Enter/Escape が効かない）、(6)【推奨】検索ファースト除外判定が Popup にハードコード、を指摘。
  - 分類: A（実装欠陥。設計の目的・要件は不変で、実装/配線の是正のみ）
  - 戻り先: モード2（`modeMachine.ts` / `useMode.ts` / `SearchHeader.tsx` / `PopupShell.tsx` / `Popup.tsx`）
  - 対応: (1) コメントの `*/` を除去。(2) 宣言を非 export 化しファイル末尾へ集約（既存 pure module 規約に整合）。(3)(5) キー処理を Popup の **document レベル単一リスナー**へ集約し、フォーカス非依存で LIST キーが効くよう配線。`SearchHeader`/`PopupShell` から onKeyDown を撤去。(6) `isSearchFirstExempt(mode)` を純粋関数として `modeMachine.ts` に追加し Popup はそれを呼ぶだけに。(4) `eslint --fix` で整形。あわせて reducer 保護分岐・`isSearchFirstExempt` のテストを追加（40→42件）。design.md のデータフロー/API 記述も実装に追従して更新。
  - 再検証結果: full-repo `pnpm type-check`（14）/`pnpm lint`（15）/`pnpm test`（12・popup 42件）すべて exit 0。

---

## 実装後の振り返り

### 実装完了日
2026-07-27（実装着手・計画は 2026-07-26、受け入れ承認は 2026-07-27）

### 計画と実績の差分

**計画と異なった点**:
- **キー処理の配線方式を「検索入力の onKeyDown」から「document レベルの単一リスナー」へ変更**。当初 design.md は SearchHeader の onKeyDown 起点を想定していたが、検証（ラウンド1・問題5）で「フォルダボタンにフォーカスが移ると LIST キーが効かない」フォーカス依存の欠陥が判明。document レベルに集約することでフォーカス非依存にし、あわせて静的 `<div>` への onKeyDown（a11y 違反）も回避した。design.md のコンポーネント設計・データフローを実装に追従して更新済み。
- **`resolveShortcutAction`（ModeAction を返す）→ `resolveShortcutIntent`（ShortcutIntent を返す）に変更**。ENTER_* は `targetId` を要するが、ショートカット解決時点では対象行が未確定のため「意図のみ返し、呼び出し側が targetId を添える」設計に是正。
- **`isSearchFirstExempt(mode)` を純粋関数として追加**（当初は Popup にハードコード予定だった除外判定を modeMachine へ集約）。PANEL も対象に含め、U12 実装時に Popup を編集せず済むようにした。

**新たに必要になったタスク**:
- 検証ラウンド1の是正（コメント誤終端 `*/`・export 規約・a11y・Prettier・フォーカス依存・除外判定集約）。いずれも分類A（実装欠陥）として計画再承認なしでモード2に戻って対応。
- reducer 保護分岐（全 ENTER_* の非LIST拒否）と `isSearchFirstExempt` のユニットテスト追加（40→42件）。

**技術的理由でスキップしたタスク**: なし（全タスク完了）。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 1
- 主な不一致と分類: A（実装欠陥）1ラウンド。ビルド/lint を壊すコメント誤終端・規約違反と、フォーカス依存のキー操作欠落を是正。設計・要件の前提崩れ（B/C）はなし。
- 受け入れ承認: 2026-07-27 取得。

### 学んだこと

**技術的な学び**:
- **ブロックコメント内の `*/` は字句レベルでコメントを終端する**（`enter*/exitToList` が原因で type-check/lint/build が失敗）。散文コメントで記号列を書く際は要注意。
- **キーボード操作はフォーカス位置に依存させない**方が堅牢。検索ファーストUIでは focus が容易に移動するため、document レベルの単一リスナー＋純粋なインテント解決の組み合わせが相性が良い。
- pure logic（modeMachine）と React 層（useMode）の分離により、モードの UI 実体が無い段階でも**キー意味論を単体テストで網羅**でき、後続単位の接続点を先に固められた。

**プロセス上の改善点**:
- turbo の TUI をバックグラウンド実行すると exit code が当てにならない場合がある（出力が空で exit 0）。**品質ゲートはフォアグラウンドで exit code を明示確認**すべき。今回 implementation-validator の指摘で気づけた。

### 次回への改善提案
- コメントに記号列（`*/`, 正規表現片など）を含める場合は、書いた直後に該当ファイル単体で type-check/lint をフォアグラウンド実行して早期に検出する。
- UI にキーハンドラを足す際は「フォーカスがどこにあり得るか」を最初に洗い出し、必要なら document レベル配線を初期設計に含める（後戻りを減らす）。
