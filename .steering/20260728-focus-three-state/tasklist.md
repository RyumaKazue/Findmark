# タスクリスト — U8a focus-three-state

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### 実装可能なタスクのみを計画
- 計画段階で「実装可能なタスク」のみをリストアップ
- 「将来やるかもしれないタスク」は含めない
- 「検討中のタスク」は含めない

### タスクスキップが許可される唯一のケース
以下の技術的理由に該当する場合のみスキップ可能:
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:
```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

### タスクが大きすぎる場合
- タスクを小さなサブタスクに分割
- 分割したサブタスクをこのファイルに追加
- サブタスクを1つずつ完了させる

---

## フェーズ1: modeMachine の型とモード遷移

- [x] `Mode` に `FOLDER_TREE` を追加
- [x] `ListFocus`（`'search' | 'result'`）を定義し JSDoc を付ける
- [x] `FocusArea`（`'search' | 'result' | 'folderTree'`）と導出関数 `toFocusArea(mode, listFocus)` を実装
  - [x] 「`focusArea` を独立 state として持たない（二重管理の回避）」意図を JSDoc に明記
- [x] `ModeAction` に `ENTER_FOLDER_TREE` を追加
- [x] `modeReducer` で `ENTER_FOLDER_TREE` を LIST からのみ許可（不正遷移は現状維持に倒す）
- [x] ファイル冒頭のモジュール JSDoc をフォーカス3状態の設計に合わせて是正
- [x] export 一覧（ファイル末尾）に新しい型・関数を追加

## フェーズ2: キー意味論（resolveKeyIntent）の拡張

- [x] `KeyIntent` に新インテントを追加
  - [x] `list:leave-search-up` / `list:leave-search-down`
  - [x] `list:to-folder-tree`
  - [x] `folder:move-up` / `folder:move-down` / `folder:parent` / `folder:to-result` / `folder:toggle-expand` / `folder:home`
- [x] `list:escape` を `escape:step-back` へ改名（LIST と FOLDER_TREE で梯子を共有するため）
- [x] `resolveKeyIntent` を `(mode, e, listFocus)` の3引数に拡張
  - [x] LIST + `search`: `↑↓` = leave-search 系 / `←→`・`Home` = `none`（キャレット温存）/ `Enter` = `list:open` / `Escape` = `escape:step-back`
  - [x] LIST + `result`: `↑↓` = move 系 / `←` = `list:to-folder-tree` / `→` = `none` / `Enter` = `list:open` / `Escape` = `escape:step-back`
  - [x] FOLDER_TREE: `↑↓` = folder:move 系 / `←` = `folder:parent` / `→` = `folder:to-result` / `Enter` = `folder:toggle-expand` / `Home` = `folder:home` / `Escape` = `escape:step-back`
  - [x] INLINE_EDIT / ALIAS_EDIT / PANEL / DRAG は既存の挙動を維持
  - [x] `Ctrl/Cmd+Enter` は `none` のまま（新規タブは対応単位で別途・スコープ外）
- [x] `resolveKeyIntent` の JSDoc をフォーカス位置別の表に合わせて是正

## フェーズ3: Escape の4段階戻り

- [x] `resolveListEscape` を `resolveEscapeStep` へ改名
- [x] 文脈型を `EscapeContext`（`focusArea` / `hasQuery` / `hasScope`）へ拡張
- [x] 戻り値型を `EscapeStep`（`focus-search` / `clear-keyword` / `clear-scope` / `close`）へ拡張
- [x] 4段階の優先順位を実装（focusArea が search 以外 → `focus-search` を最優先）
- [x] `isSearchFirstExempt` が `FOLDER_TREE` を対象外にしていない（＝検索へ復帰する）ことを確認

## フェーズ4: modeMachine のユニットテスト

- [x] 既存テストを新シグネチャ・新名称へ追随させる
  - [x] `resolveKeyIntent` の第3引数（`'search'` / `'result'`）を明示
  - [x] `list:escape` → `escape:step-back` へ
  - [x] `resolveListEscape` → `resolveEscapeStep`（既存3ケースに `focusArea: 'search'` を付与）
- [x] `modeReducer` のテストを追加
  - [x] `ENTER_FOLDER_TREE` が LIST からのみ有効
  - [x] 非 LIST からの `ENTER_FOLDER_TREE` は現状維持
  - [x] FOLDER_TREE からの `EXIT_TO_LIST` で LIST / targetId=null に戻る
- [x] `resolveKeyIntent` のテストを追加
  - [x] LIST + `search`: `↑↓` が leave-search 系になる
  - [x] **LIST + `search`: `←→` と `Home` が `none`（クエリ途中の修正を担保する要件）**
  - [x] LIST + `result`: `↑↓` が move 系 / `←` が to-folder-tree / `→` が none
  - [x] FOLDER_TREE: `↑↓` / `←` / `→` / `Enter` / `Home` / `Escape` の全割り当て
- [x] `toFocusArea` のテストを追加（3状態の導出）
- [x] `resolveEscapeStep` のテストを追加（4段階すべて・focusArea 優先）
- [x] `isSearchFirstExempt` のテストに `FOLDER_TREE` が対象（exempt でない）ことを追加

## フェーズ5: useMode の拡張

- [x] `enterFolderTree()` を追加し `UseModeApi` に公開
- [x] `resolveKey` のシグネチャを `(e: KeyLike, listFocus: ListFocus) => KeyIntent` に拡張
- [x] `listFocus` を `useMode` の内部 state にしない方針を JSDoc に明記（DOM 操作を伴うため Popup が所有）

## フェーズ6: Popup のフォーカス3状態の結線

- [x] `listFocus` state（`'search' | 'result'`・初期値 `'search'`）を追加
- [x] `focusSearch()` ヘルパを実装（`exitToList()` + `listFocus='search'` + `input.focus()`）
- [x] `leaveSearch(delta)` ヘルパを実装（`listFocus='result'` + **`input.blur()`** + 選択行を ±1 クランプ移動）
- [x] キーハンドラを新インテントに対応させる
  - [x] `list:leave-search-up` / `list:leave-search-down`
  - [x] `list:move-up` / `list:move-down`（既存の移動処理を流用）
  - [x] `list:to-folder-tree` → `enterFolderTree()`
  - [x] `folder:to-result` → `exitToList()` + `listFocus='result'`
  - [x] `list:open`（既存。ボタン上のネイティブ活性化ガードは維持）
  - [x] `escape:step-back` → `resolveEscapeStep` の結果を実行（4段階）
  - [x] `folder:move-*` / `folder:parent` / `folder:toggle-expand` / `folder:home` は未結線のまま（U11）。その旨をコメントで明記
- [x] 検索ファースト復帰を `focusSearch()` 経由に変更（`listFocus` を戻し、FOLDER_TREE なら LIST へ戻す）
- [x] `resolveKey` 呼び出しに `listFocus` を渡す
- [x] `mode === 'FOLDER_TREE'` のとき sidebar にフォーカスリングを付ける（Popup 側でラップ。`FolderTree.tsx` は変更しない）
- [x] `useEffect` の依存配列に `listFocus` 等の新しい依存を漏れなく追加
- [x] コンポーネント JSDoc を U8a の内容に是正

## フェーズ7: 対象外ファイルの不変確認

- [x] `FolderTree.tsx` / `FolderTreeItem.tsx` / `SearchHeader.tsx` / `ResultList.tsx` を変更していないことを `git status` / `git diff --stat` で確認
- [x] 変更ファイルが `modeMachine.ts` / `modeMachine.test.ts` / `useMode.ts` / `Popup.tsx` の4つに収まっていることを確認

## フェーズ8: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `pnpm test`（全12タスク成功。popup 68件 [Backspace対応で31→36件、他既存分含め計68件]）
- [x] リントエラーがないことを確認
  - [x] `pnpm lint`（全15パッケージ成功。import整形1件は `--fix` で自動修正済み）
- [x] 型エラーがないことを確認
  - [x] `pnpm type-check`（全14パッケージ成功）

## フェーズ9: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.mdの各要件）と実装を突き合わせOK/NGを一覧化（下記参照。全項目OK）
- [x] `implementation-validator` サブエージェントによる独立検証を実施（重大な問題なし。`blur()`タイミング・スコープ境界・`modeReducer`防御・依存配列の網羅性を独立確認）
- [x] ユーザーに検証を依頼
- [x] 受け入れ承認（ゲート2）を取得（2026-07-28）
  - NGがあった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ10: ドキュメント更新・振り返り（モード4）

- [x] `docs/mvp-development-flow.md` の「進捗」表で U8a を `✅ 完了 (2026-07-28)` に更新し、steering ディレクトリ列を記入
- [x] 「MVP完成の定義」の `U6a / U8a` チェックボックスを `[x]` に更新（U6a は完了済みのため、U8a 完了で条件が満たされる）
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

- ラウンド1（2026-07-28）
  - 不一致内容: ユーザーレビューにより2点指摘。(1) 検索ファースト復帰のトリガーが印字文字のみで、Backspaceでも復帰してほしい。(2) 📎クリック後に矢印キーで移動すると、実DOMフォーカスが検索ボックスに残ったままに見える（内部フォーカスモデルとの不一致）。
  - 分類:
    - (1) は **C（要件の認識ズレ/追加）**: requirements.md に「Backspaceでの復帰」が明記されていなかった。
    - (2) は **U11へのスコープ移管**: U8aの対象領域（`FolderTree.tsx`/`ResultRow.tsx` は対象外）を踏まえ、機能的な破綻がないこと（内部モデルに従って正しく動作する）を根拠にU8aでは対応せずU11へ持ち越す方針を提案し、ユーザーが承認。さらにユーザーからマウス操作自体の再設計案（展開三角とフォルダ名クリックの分離、📎ボタン廃止）が提示され、この根本解決策をU11の設計として確定した。
  - 戻り先: requirements.md（(1)の受け入れ基準に追記）→ モード2（実装: `isSearchFirstTriggerKey` 追加）。(2) は実装不要（設計文書への記録のみ）。
  - 対応: (1) `modeMachine.ts` に `isSearchFirstTriggerKey`（`isPrintableKey` + 修飾なし `Backspace`）を追加し `Popup.tsx` で使用。テスト5件追加（計36件）。関連ドキュメント6件を更新。(2) は `functional-design.md`/`design/README.md`/`mvp-development-flow.md`(U7・U11行)/`ideas/keyboard-first-navigation.md` の4件を更新し、U11の設計決定として記録（U8aのコード変更なし）。
  - 再検証: 上記対応後、`pnpm test`（popup 68件）/ `pnpm lint` / `pnpm type-check` を再実行し全パスを確認。ユーザーより最終承認を取得（2026-07-28）。

---

## 実装後の振り返り

### 実装完了日
2026-07-28

### 計画と実績の差分

**計画と異なった点**:
- design.md はフォーカス3状態の切り替え自体は正しく見積もれていたが、**検索ファースト復帰のトリガーが印字文字のみ**という前提だった。ユーザーレビューで「Backspaceでも復帰してほしい」という要望が入り、`isSearchFirstTriggerKey` を新設して対応した。既存の `isPrintableKey` に依存するトリガー判定を、フォーカス復帰専用のより広い判定へ分離する形で自然に拡張でき、設計の骨格（modeMachine に純粋関数として集約する方針）が効いた。
- U8aのスコープ外だった📎ボタンの扱いについて、当初は「U11で対応を検討する」という先送りの記録に留める想定だったが、レビューの過程でユーザーからマウス操作自体の再設計案（展開三角とフォルダ名クリックの分離、📎廃止）が提示され、根本解決策としてU11の設計に確定させることになった。これはU8aのコード変更を伴わないが、ドキュメント更新の範囲が当初の想定より広がった（`functional-design.md`/`design/README.md`/`mvp-development-flow.md`(U7・U11)/`ideas/keyboard-first-navigation.md` の4件）。

**新たに必要になったタスク**:
- `isSearchFirstTriggerKey` の新設・テスト5件・`Popup.tsx` への結線（フェーズ4/6の延長として実施。新フェーズは追加せず既存フェーズ内で対応）。
- U11向けのマウス操作再設計をドキュメントへ記録するタスク（U8a自体のタスクリストには追加せず、docs更新として実施）。

**技術的理由でスキップしたタスク**:
- なし。全タスクを実施した。

**⚠️ 注意**: 「時間の都合」「難しい」などの理由でスキップしたタスクはここに記載しないこと。全タスク完了が原則。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 1（要件追加1件・スコープ移管1件、いずれも設計の再承認[ゲート1]は不要な軽微な変更として処理）
- 主な不一致と分類: (1) C（要件の認識ズレ/追加・Backspace対応）、(2) 実装不要のスコープ移管（U11の設計として記録）
- 受け入れ承認: 2026-07-28

### 学んだこと

**技術的な学び**:
- `modeMachine.ts` に「フォーカス復帰のトリガー判定」を専用の合成関数（`isSearchFirstTriggerKey`）として切り出したことで、将来さらにトリガーキーを増やす場合も1箇所の追加で済む構造になった。既存の `isPrintableKey` を壊さずに内包する形にしたのも、テストの後方互換性を保つうえで効果的だった。
- マウス駆動の実DOMフォーカスとキーボード駆動の内部フォーカスモデル（`listFocus`/`mode`）は、独立して動きうる別々のtrackであるという前提を早期に明文化できたのが良かった。この整理により「機能的には正しいが視覚的に紛らわしい」という状態を、バグ扱いにせず設計判断として次単位に委ねる、という筋の通った意思決定ができた。
- U8 で確立した「モード入口の定義だけ先に用意し、UI実体は後続単位に委ねる」パターン（INLINE_EDIT/PANEL/DRAG）が、U8aのFOLDER_TREEインテント（`folder:move-*` 等の未結線）にもそのまま踏襲でき、単位分割の一貫性が保たれた。

**プロセス上の改善点**:
- `implementation-validator` サブエージェントに実装判断の妥当性（`blur()`タイミング、スコープ境界の遵守）を独立検証させたことで、レビューの質が上がった。特に「設計時の想定が実装時に覆った」パターン（U6aでの`folderIdPath`削除、今回のマウス/キーボードtrack分離）を扱う単位では有効。
- ユーザーレビューが単なるバグ指摘に留まらず、UI設計そのものの再考（📎廃止）にまで発展した。ステアリングの「検証→戻る」フローが、実装済み単位のacceptanceゲートでありながら次単位の設計インプットを拾う場としても機能した。

### 次回への改善提案
- U11着手時は、本振り返りに記録した「展開三角とフォルダ名クリックの分離」「📎廃止」「子なしフォルダも選択可能に」を requirements.md に直接引き写せる状態にしてある（`mvp-development-flow.md` U11行・`ideas/keyboard-first-navigation.md` に記録済み）ため、計画フェーズでの手戻りは少ないはず。
- U11は`FolderTree.tsx`/`FolderTreeItem.tsx`という新しい対象ファイルに触れる最初の単位になる。U8aで確立した「フォーカス3状態」のインテント（`folder:move-*`等）をそのまま結線する形で進められるよう、design.md 作成時に本ファイル（U8aのdesign.md/tasklist.md）を参照すること。
