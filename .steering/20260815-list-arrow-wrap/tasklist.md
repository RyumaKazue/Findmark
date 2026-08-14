# タスクリスト

**作業単位**: `list-arrow-wrap`（LIST モードの ↑↓ 循環ナビゲーション）
**参照**: [requirements.md](./requirements.md)（AC-1〜AC-9） / [design.md](./design.md)

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

## フェーズ1: 循環ロジックの純粋モジュール（AC-7 / AC-4）

- [x] `pages/popup/src/hooks/listNavigationModel.ts` を新規作成
  - [x] ファイル冒頭 JSDoc に責務（選択インデックスの移動計算）・React/DOM/`chrome.*` 非依存である理由・`modeMachine.ts` に入れない理由を記述
  - [x] `moveSelectionIndex(current: number, delta: number, count: number): number` を実装
    - [x] `count <= 0` は `0` を返すガード
    - [x] 負数対応の剰余 `(((current + delta) % count) + count) % count` で循環と範囲外正規化を 1 式で行う
    - [x] `delta` を `number` で受ける理由（将来の PageUp/PageDown 再利用）をコメントに残す
  - [x] 既存 pure module に倣い宣言は非 export とし、ファイル末尾で `export { moveSelectionIndex }` にまとめる

## フェーズ2: ユニットテスト（AC-7）

- [x] `pages/popup/src/hooks/listNavigationModel.test.ts` を新規作成（co-located / vitest）
  - [x] 中間から `-1` / `+1`（`(3,-1,10)===2` / `(3,1,10)===4`）
  - [x] 先頭から `-1` → 末尾（`(0,-1,10)===9`）: AC-1
  - [x] 末尾から `+1` → 先頭（`(9,1,10)===0`）: AC-2
  - [x] 1 件のとき `-1` / `+1` はどちらも `0`: AC-4
  - [x] 0 件のとき `-1` / `+1` はどちらも `0`: AC-4
  - [x] `count` が負でも `0`（防御的デフォルト）
  - [x] `current` が範囲外（上振れ・下振れ）でも戻り値が `0 <= n < count`: AC-4
  - [x] `delta` が 0 のときは現在値（範囲内に正規化）を返す
  - [x] 追加: ±1 の往復で元のインデックスへ戻る（端でも成立）

## フェーズ3: Popup への結線（AC-1 / AC-2 / AC-3）

- [x] `pages/popup/src/Popup.tsx` を変更
  - [x] `listNavigationModel` から `moveSelectionIndex` を import
  - [x] `case 'list:move-up'` を `setSelectedIndex(i => moveSelectionIndex(i, -1, results.length))` に差し替え
  - [x] `case 'list:move-down'` を `setSelectedIndex(i => moveSelectionIndex(i, 1, results.length))` に差し替え
  - [x] `leaveSearch` の移動計算を `setSelectedIndex(i => moveSelectionIndex(i, delta, results.length))` に差し替え、`useCallback` の deps を `[lastIndex]` → `[results.length]` へ更新（`setListFocus('result')` / `blur()` の副作用は変更しない）
  - [x] `lastIndex`（L147 付近）の参照が 0 になったことを `grep` で確認して削除する（残っていれば残す）
  - [x] keydown effect の deps から `lastIndex` を除去し、`results.length` で整合させる（`results.length` は既存 deps のため追加不要だった）
  - [x] 既存の範囲外クランプ effect（L143-145）は変更しない（循環とは責務が異なるため）

## フェーズ4: キー意味論のコメント整合

- [x] `pages/popup/src/hooks/modeMachine.ts` の `resolveKeyIntent` JSDoc を更新
  - [x] 「LIST + 検索ボックス」「LIST + 右ペイン」の `↑↓` の説明に **端で循環する**旨を追記（型・分岐・インテント定義は変更しない）
  - [x] `KeyIntent` 定義側にも「LIST の 4 インテントは循環 / 計算は `listNavigationModel` / 左ペインはクランプ」の注記を追加
  - [x] `FOLDER_TREE` / `ALIAS_EDIT` / `PANEL` の記述は変更しない（AC-6・スコープ外であることが読み取れる状態にする）

## フェーズ5: 品質チェックと修正（AC-8）

> **フォアグラウンドで実行し exit code を必ず確認する**（バックグラウンド実行では turbo が失敗しても exit 0 を返すことがある）。

- [x] `implementation-validator` サブエージェントによる品質検証を実施し、指摘に対応する
  - 総合 **4.8/5**（スペック準拠 4/5・コード品質 5/5・テスト 5/5・セキュリティ 5/5・パフォーマンス 5/5）
  - **コード欠陥の指摘は 0 件**。指摘は AC-9（ドキュメント未更新）1 件のみで、これは本タスクリスト上フェーズ7（ゲート2 後）に配置しているため想定内
  - 裏取りされた点: `lastIndex` の参照消滅（削除漏れなし）/ keydown effect に元から `results.length` があり stale closure なし / `ResultList` の追従は絶対位置計算のため大ジャンプでも正しい（AC-5）/ 範囲外クランプ effect は循環後 no-op（競合なし）/ `moveSelectionIndex` の呼び出しは LIST の 3 箇所のみ（AC-6）
- [x] 追加: `pnpm build` をフォアグラウンドで実行し exit code 0 を確認する（13 tasks successful）
- [x] すべてのテストが通ることを確認
  - [x] `pnpm test` → **exit 0**（13 tasks / popup 185 tests passed。新規 `listNavigationModel.test.ts` 9 件を含む）
- [x] リントエラーがないことを確認
  - [x] `pnpm lint`（`--continue` のため各パッケージの結果と最終 exit code を確認）→ **exit 0**（12 tasks successful）
- [x] 型エラーがないことを確認
  - [x] `pnpm type-check` → **exit 0**（11 tasks successful）

## フェーズ6: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.md の AC-1〜AC-9）と実装を突き合わせ OK/NG を一覧化

| AC | 内容 | 判定 | 根拠 |
|---|---|---|---|
| AC-1 | 右ペイン: 先頭で `↑` → 末尾 | ✅ OK | `moveSelectionIndex(0,-1,10)===9` のテスト / `case 'list:move-up'` が委譲 |
| AC-2 | 右ペイン: 末尾で `↓` → 先頭 | ✅ OK | `moveSelectionIndex(9,1,10)===0` のテスト / `case 'list:move-down'` が委譲 |
| AC-3 | 検索ボックスからの `↑↓` も同じ循環規則 | ✅ OK | `leaveSearch` が同関数へ委譲。`setListFocus('result')` / `blur()` の副作用は U8a から不変 |
| AC-4 | 0件 / 1件 / 範囲外でも壊れない | ✅ OK | `count<=0` ガード + 負数対応剰余。該当テスト 4 件 |
| AC-5 | 循環時にスクロールが追従 | ✅ OK（要実機確認） | `ResultList` L114-126 が絶対位置 `selectedIndex*ROW_HEIGHT` で判定するため大ジャンプでも成立（validator が裏取り） |
| AC-6 | 他モード・他 UI の `↑↓` は不変 | ✅ OK | `moveSelectionIndex` の呼び出しは LIST の 3 箇所のみ。`folderTreeModel.moveRow` は端で `null`、`AddCurrentPanel` は独自 `clampIndex` のまま |
| AC-7 | 純粋関数 + co-located ユニットテスト | ✅ OK | `listNavigationModel.ts` / `.test.ts`（9 ケース・全パス） |
| AC-8 | `pnpm test` / `lint` / `type-check` が exit 0 | ✅ OK | それぞれ exit 0（13 / 12 / 11 tasks）。加えて `pnpm build` も exit 0 |
| AC-9 | `docs/functional-design.md` の整合 | ⏳ 未実施 | 本タスクリストのフェーズ7（ゲート2 後・モード4）に配置。承認後に実施 |

- [x] ユーザーに検証を依頼（ラウンド1 で NG → 検証ログ参照）
- [x] 受け入れ承認（ゲート2）を取得 → **2026-08-15 承認（ラウンド4）**
  - NG があった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る → ラウンド1〜3 はいずれも**分類A**で対応済み

## フェーズ8: ホバーによる選択奪取の修正（ラウンド1 NG 対応・分類A）

- [x] T8-1: `ResultRow.tsx` のホバー選択を `onMouseEnter` → `onMouseMove` へ変更し、理由（スクロールでカーソル下の要素が変わると Chrome が `mouseenter` を発火する / 仮想スクロールの再マウントでも発火する）をコメントに残す
- [x] T8-2: `ResultRow.tsx` / `ResultList.tsx` の `onHover` prop の JSDoc を「実際にマウスが動いたときのみ」に更新する
- [x] T8-3: 同一パターンの横断確認（`grep onMouseEnter`）を行い、影響範囲を洗い出す
  - `MovePanel.tsx:143`（`onMouseEnter` + L77 `scrollIntoView`）に**同一の欠陥**を確認。ゲート2 で報告 → **ユーザー指示により本単位で併せて修正する**（T8-6）
  - `AddCurrentPanel` / `AliasEditor` / `FolderTreeItem` にはホバー選択が無く該当なし
- [x] T8-6: `MovePanel.tsx` のホバー選択を `onMouseEnter` → `onMouseMove` へ変更する（`Ctrl/Cmd+M` のフォルダ移動パネル。1件移動・一括移動の両用途で発現しうる）
  - AC-6 との関係: `↑↓` のキー意味論（`clampIndex` による端クランプ）は変更していない。修正対象はホバーによる選択奪取のみのため AC-6 に抵触しない
- [x] T8-4: 再ゲート（`type-check` / `lint` / `test` / `build` をフォアグラウンドで exit 0 確認）→ 11 / 12 / 13 / 13 tasks すべて **exit 0**

## フェーズ9: FOLDER_TREE で追加ダイアログが出ない不具合の修正（ラウンド2 NG 対応・分類A / 本単位外の既存バグ）

- [x] T9-1: 原因の特定
  - **原因1（キー経路）**: `Ctrl/Cmd+D` の処理が `if (currentMode === 'LIST')` ブランチの内側にあり、FOLDER_TREE では発火しない
  - **原因2（モード遷移）**: `modeReducer` の `ENTER_PANEL` は LIST からのみ有効なため、ヘッダー「＋追加」ボタン（FOLDER_TREE でもマウスで押せる）経由でも `enterPanel()` が現状維持に倒れ、**ブックマークは登録されるのにパネルが表示されない**（`addCurrentPanelOpen` だけ true で残り、以降 MovePanel が抑止される state 汚染も発生）
  - U11 で起動直後の既定モードが FOLDER_TREE になって以降、「ポップアップを開いた直後の Ctrl+D / ＋追加」という主要導線が丸ごと機能していなかった
- [x] T9-2: `Ctrl/Cmd+D` の処理を LIST ブランチの外へ移し、`!isSearchFirstExempt(currentMode)`（= LIST / FOLDER_TREE）で有効化する（アンドゥ Ctrl+Z と同じ判定を再利用。INLINE_EDIT/ALIAS_EDIT/PANEL/DRAG では横取りしない）
- [x] T9-3: `handleOpenAddCurrent` に `exitToList()` を挟み、FOLDER_TREE → LIST → PANEL と遷移させる（既存 `enterAliasEditAt` L250-251 と同じ慣例。同一 reducer への dispatch はキュー順に適用される）
- [x] T9-4: 再ゲート（`type-check` / `lint` / `test` / `build`）→ 11 / 12 / 13 / 13 tasks すべて **exit 0**
- [x] T9-5: 実機で再確認する（FOLDER_TREE で `Ctrl/Cmd+D` / ヘッダー「＋追加」の両経路）→ ゲート2 で承認

## フェーズ10: FOLDER_TREE で一括移動ができない不具合の修正（ラウンド3 NG 対応・分類A / フェーズ9 と同型）

- [x] T10-1: 原因の特定 — フェーズ9 とまったく同じ2重の原因
  - **原因1（キー経路）**: `Ctrl/Cmd+M` の処理が LIST ブランチの内側にあり FOLDER_TREE で発火しない
  - **原因2（モード遷移）**: `openBulkMovePanel()` の `enterPanel()` が LIST からのみ有効。`BulkActionBar` は
    `selectionCount > 0` だけを条件にモードを問わず表示されるため、**FOLDER_TREE では「移動」ボタンが見えているのに押しても何も起きず**、
    `bulkMovePanel` だけ true で残る state 汚染も発生していた（「削除」ボタンはモード遷移を伴わないため動作していた）
- [x] T10-2: `openBulkMovePanel` に `exitToList()` を挟む（`handleOpenAddCurrent` と同じ処置）
- [x] T10-3: `Ctrl/Cmd+M` の**一括移動のみ**を LIST ブランチの外へ出し、`selectionCount > 0 && !isSearchFirstExempt(currentMode)` で有効化する
  - 選択なしの単一行移動は「フォーカス中の結果行」が対象のため LIST ブランチに残す（到達不能になった分岐を削除して整理）
- [x] T10-4: 再ゲート（`type-check` / `lint` / `test` / `build`）→ 11 / 12 / 13 / 13 tasks すべて **exit 0**
- [x] T10-5: 実機で再確認する（FOLDER_TREE でチェック → `Ctrl/Cmd+M` / 一括操作バーの「移動」の両経路）→ ゲート2 で承認

## フェーズ11: 同型バグの棚卸し（`LIST` ブランチ内ショートカットの全件監査）

判定基準: **「対象がフォーカス中の結果行か（＝行に紐づく）」か「対象がチェック選択/対象なしか（＝フォーカス位置に依存しない）」**。
後者を `if (currentMode === 'LIST')` の内側に置くと FOLDER_TREE で機能しない（U11 が既定モードを変えて以降の構造的な見落とし）。

- [x] T11-1: 全ショートカットを監査する

| ショートカット | 対象 | 現状 | 判定 |
|---|---|---|---|
| `Ctrl/Cmd+Z`（アンドゥ） | 直近の操作 | 共通ブロック（LIST/FOLDER_TREE 可） | ✅ 問題なし（既に共通化済み） |
| `Escape`（選択解除） | チェック選択 | `LIST \|\| FOLDER_TREE` を明示 | ✅ 問題なし |
| `Ctrl/Cmd+D`（現在ページ登録） | 対象なし | **共通ブロックへ移動** | ✅ フェーズ9 で修正 |
| `Ctrl/Cmd+M`（一括移動） | チェック選択 | **共通ブロックへ移動** | ✅ フェーズ10 で修正 |
| `Ctrl/Cmd+M`（単一移動） | フォーカス中の行 | LIST のみ | ✅ 妥当（行に紐づく） |
| `F2` / `Ctrl+E`（インライン編集） | フォーカス中の行 | LIST のみ | ✅ 妥当（行に紐づく） |
| `Ctrl/Cmd+;`（別名編集） | フォーカス中の行 | LIST のみ | ✅ 妥当（行に紐づく） |
| `Delete`（単一削除） | フォーカス中の行 | LIST + `listFocus==='result'` | ✅ 妥当（行に紐づく） |
| `Delete`（一括削除） | チェック選択 | LIST + `listFocus==='result'` のみ | ⚠️ **同型の未修正**（下記 T11-2） |
| `Ctrl/Cmd+A`（全件選択） | 表示結果全件 | LIST + `listFocus!=='search'` のみ | ⚠️ **同型の未修正**（下記 T11-2） |

- [x] T11-2: 残る2件をゲート2 で報告し、対応可否をユーザー判断に委ねる
  - **`Delete`（一括削除）**: 一括操作バーの「削除」ボタンはモード遷移を伴わないため FOLDER_TREE でも動作する一方、`Delete` キーは効かない（ボタンとキーで不整合）。
    ただし**破壊的操作**であり、ツリー上の `Delete` には「フォルダを削除」という別解釈の余地もあるため、独断で有効化せず判断を仰ぐ。
  - **`Ctrl/Cmd+A`（全件選択）**: 非破壊だが同じ構造。FOLDER_TREE で押しても全件選択されない。

- [x] T8-5: 実機で再確認し、ゲート2 を再提示する → **ラウンド4 で受け入れ承認を取得（2026-08-15）**

## フェーズ7: ドキュメント更新・振り返り（モード4・AC-9）

- [x] `docs/functional-design.md` のキー挙動表を更新
  - [x] 右ペイン(LIST) の `↑↓` を「選択行の移動(端で循環)」へ変更
  - [x] 検索ボックス(LIST) の `↑↓` にも循環する旨を補記
  - [x] 左ペイン(FOLDER_TREE) には「端では何もしない」を**明示**（循環との差を読み取れるようにする）
  - [x] 表の下に変更理由（末尾への到達性・無反応に見える問題・ランチャー系の作法・左ペインを循環させない理由・`moveSelectionIndex` の所在）を注記
- [x] `docs/product-requirements.md` のショートカット一覧の「端では何もしない」を「端で循環」へ更新（右ペイン・検索ボックスの2箇所）
- [x] 追加: フェーズ9/10 の修正に伴うドキュメント整合
  - [x] `docs/functional-design.md` 画面遷移図の下に「行に紐づく操作 / 行に紐づかない操作」の区別と、後者が `FOLDER_TREE` でも有効である旨の表・理由を追記
  - [x] `docs/product-requirements.md` の受け入れ基準に「行に紐づかない操作は FOLDER_TREE でも動作する」を追加
  - [x] `docs/product-requirements.md`「編集・整理」の見出しから `(LISTモード)` を外し、各ショートカットに有効モードの注記を付与
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

### ラウンド1（ゲート2 ユーザー検証・2026-08-15）

- **不一致内容**: 可視範囲の一番下にフォーカスがある状態で `↓` を押すと、次の行ではなく**可視範囲の一番上**にフォーカスが移る。
- **切り分け**: ユーザー確認により「マウスカーソルをリストの外へ出すと再現しない」と判明。
- **原因**: `ResultRow.tsx` のホバー選択が `onMouseEnter` に結線されていた（U7 由来）。`↑↓` で選択が可視範囲の端に達すると
  `ResultList` の追従 effect が `scrollTop` をずらすが、Chrome は**マウスを動かしていなくてもスクロールでカーソル下の要素が
  変わった時点で `mouseenter` を発火する**（仮想スクロールが行を `node.id` キーで再マウントするため確実に発火）。
  結果、`moveSelectionIndex` が正しく返した `index+1` が、直後のホバーで「カーソルが乗っているだけの行」へ上書きされていた。
- **分類**: **A（実装欠陥）**。ただし本単位の変更起因ではなく U7 からの既存バグ（`git diff dev` で `ResultRow.tsx` /
  `ResultList.tsx` が本単位未変更であることを確認済み）。`↓` キーの経路上にあり AC-5 の検証を妨げるため、本単位で対応する。
- **戻り先**: モード2（実装）。計画（requirements / design）の前提は崩れていないため**ゲート1 の再承認は不要**。
- **対応**: フェーズ8（`onMouseEnter` → `onMouseMove`）。
- **副次的発見**: `MovePanel.tsx`（L77 `scrollIntoView` + L143 `onMouseEnter`）に同一パターンの欠陥あり。
  ゲート2 で報告 → **ユーザー指示により本単位で併せて修正**（T8-6）。`↑↓` のキー意味論は変更していないため AC-6 に抵触しない。

### ラウンド2（ゲート2 ユーザー検証・2026-08-15）

- **不一致内容**: `FOLDER_TREE` モード（＝起動直後の既定モード）で追加ダイアログ（`AddCurrentPanel`）が表示されない。
- **原因**: 2つの独立した要因が重なっていた。
  1. `Ctrl/Cmd+D` の処理が `if (currentMode === 'LIST')` ブランチの内側にあり、FOLDER_TREE では発火しない。
  2. `modeReducer` の `ENTER_PANEL` は LIST からのみ有効。ヘッダー「＋追加」ボタン経由（FOLDER_TREE でもマウスで押せる）でも
     `enterPanel()` が現状維持に倒れ、**ブックマークは登録されるのにパネルが出ない**。さらに `addCurrentPanelOpen` が
     true のまま残り、以降 `MovePanel` が抑止される state 汚染も起きていた。
- **分類**: **A（実装欠陥）**。本単位（↑↓ 循環）とは無関係の既存バグで、U11 が起動時の既定モードを FOLDER_TREE に変えた
  時点から潜在していたもの。受け入れ検証中に発見されたため本単位で対応する。
- **戻り先**: モード2（実装）。requirements / design の前提は崩れていないため**ゲート1 の再承認は不要**。
- **対応**: フェーズ9。
- **テスト**: `modeReducer` 自体は変更していないため純粋関数テストの追加対象がなく、React 層のみの修正
  （プロジェクト方針によりコンポーネントテストは持たない）。実機確認で担保する。

### ラウンド3（ゲート2 ユーザー検証・2026-08-15）

- **不一致内容**: `FOLDER_TREE` モードでアイテムをチェックしても一括移動ができない。
- **原因**: **ラウンド2 とまったく同型**の2重の原因（`Ctrl/Cmd+M` が LIST ブランチ内 / `enterPanel()` が LIST からのみ有効）。
  `BulkActionBar` は `selectionCount > 0` のみを条件にモードを問わず表示されるため、FOLDER_TREE では
  「移動」ボタンが**見えているのに押しても何も起きない**状態だった（「削除」はモード遷移を伴わないため動作していた）。
- **分類**: **A（実装欠陥）**。本単位とは無関係の既存バグ（U13 × U11 の相互作用）。
- **戻り先**: モード2（実装）。ゲート1 の再承認は不要。
- **対応**: フェーズ10。
- **根本原因の共通性**: ラウンド2・3 はいずれも「U11 が起動時の既定モードを `FOLDER_TREE` に変えたのに、
  U13/U14 で追加した**行に紐づかない操作**（一括移動・現在ページ登録）が `if (currentMode === 'LIST')` の中に
  置かれたままだった」ことに起因する。**同じ構造の見落としが他にもないか**をフェーズ11 で棚卸しする。

---

## 実装後の振り返り

### 実装完了日
2026-08-15（ゲート2 受け入れ承認）

### 計画と実績の差分

**計画と異なった点**:
- **当初計画（フェーズ1〜7）は計画どおり一発で通った**。`moveSelectionIndex` の実装・テスト・結線・ドキュメント更新はいずれも
  design.md の想定から乖離なし（`implementation-validator` 総合 4.8/5・コード欠陥の指摘 0 件）。
- 一方で**受け入れ検証（ゲート2）で既存バグが3件発見され、フェーズ8〜11 が後付けで発生**した。
  いずれも本単位の変更起因ではなく、`↑↓`／FOLDER_TREE という「今回の変更を実機で試す動線」に乗っていたために露見したもの。

**新たに必要になったタスク**:
- フェーズ8: ホバーによる選択奪取の修正（`ResultRow` / `MovePanel` の `onMouseEnter` → `onMouseMove`）
- フェーズ9: FOLDER_TREE で追加ダイアログが出ない不具合（`Ctrl+D` のブランチ位置 + `ENTER_PANEL` の遷移制約）
- フェーズ10: FOLDER_TREE で一括移動ができない不具合（フェーズ9 と同型）
- フェーズ11: 同型バグの全件棚卸し（`LIST` ブランチ内ショートカットの監査）
- ドキュメント更新もフェーズ9/10 に伴い当初計画（`↑↓` の記述のみ）から拡大した

**技術的理由でスキップしたタスク**: なし（全タスク完了）

### 検証の要約（モード3）

- 検証→戻りのラウンド数: **3**（すべて**分類A: 実装欠陥**。requirements / design の前提は一度も崩れず、ゲート1 の再承認は不要だった）
  - ラウンド1: ホバーによる選択奪取（U7 由来の既存バグ）
  - ラウンド2: FOLDER_TREE で追加ダイアログが出ない（U11 × U14 の相互作用）
  - ラウンド3: FOLDER_TREE で一括移動ができない（U11 × U13 の相互作用・ラウンド2 と同型）
- 受け入れ承認: 2026-08-15
- 品質ゲート: 各ラウンドで `type-check` / `lint` / `test` / `build` をフォアグラウンド実行し exit 0 を確認（最終 11 / 12 / 13 / 13 tasks）

### 学んだこと

**技術的な学び**:
- **`onMouseEnter` はキーボード操作と共存できない**。Chrome はマウスを動かしていなくても「スクロールでカーソル下の要素が
  変わった」時点で `mouseenter` を発火する。仮想スクロール（行を key で再マウント）ではさらに確実に発火する。
  **キーボードで選択が動く UI のホバー選択は `onMouseMove` に結線する**のが正解（静止したカーソルでは発火しないため）。
  同じ行内の移動は `setSelectedIndex` が同値となり React が再レンダーを省くので、コストも実質増えない。
- **既定モードの変更は、モード分岐に埋まった全ショートカットの再点検を要求する**。U11 が起動時の既定モードを
  `LIST` → `FOLDER_TREE` に変えた時点で、`if (currentMode === 'LIST')` の中にあった「行に紐づかない操作」
  （`Ctrl+D`・一括移動）が丸ごと死んでいた。しかも **`enterPanel()` が現状維持に倒れるだけなので例外も型エラーも出ず、
  「ボタンは見えているのに押しても何も起きない」形で静かに壊れる**（`addCurrentPanelOpen` / `bulkMovePanel` が
  true のまま残る state 汚染まで伴う）。
- ショートカットの正しい分類軸は「モード」ではなく **「対象がフォーカス中の行か / チェック選択・対象なしか」**。
  前者は `LIST` 限定でよく、後者は `!isSearchFirstExempt(mode)`（= LIST + FOLDER_TREE）で有効にすべき。
  この基準を `docs/functional-design.md` の画面遷移図の下に表として明文化した。
- `modeReducer` の遷移制約を緩めず、呼び出し側で `exitToList(); enterPanel();` と経由させる方式は、既存の
  `enterAliasEditAt`（`Popup.tsx` L250-251）と同じ慣例。状態機械の不変条件を壊さずに到達性だけを足せる。

**プロセス上の改善点**:
- 品質ゲート（`test`/`lint`/`type-check`）＋ `implementation-validator` は**コードの正しさは十分に担保したが、
  今回の3件はいずれも通り抜けた**。純粋関数テストしか持たない方針では、React 層の結線バグ・イベント種別の誤りは
  構造的に検出できない。**実機確認（ゲート2）が唯一の検出網**であることが実証された形。
- 逆に言えば、ゲート2 を「承認をもらう儀式」ではなく**実際に触ってもらう検証工程**として運用したことが3件の発見に直結した。

### 次回への改善提案
- **既定フォーカス／既定モードを変更する単位では、`Popup.tsx` のモード分岐に埋まったショートカットを必ず全件棚卸しする**
  （本単位のフェーズ11 の表をテンプレートとして使える）。
- **キーボードとマウスが同じ state を奪い合う箇所を洗い出す**。`onMouseEnter` は残っていないが、
  今後ホバー選択を足すときは必ず `onMouseMove` にする。
- **React 層の結線を検証する軽量な手段の導入を検討する**。U11 の申し送りにも「FolderTree の scope/focus 同期を
  testing-library で軽量にテストする余地あり」とあり、今回で必要性がさらに裏づけられた。
  少なくとも「モード × ショートカット」の有効/無効マトリクスは純粋関数へ切り出せば単体テスト可能
  （例: `isShortcutEnabled(intent, mode, listFocus, selectionCount)` を `modeMachine` へ追加する案）。

### 後続への申し送り（未対応事項）

1. **`Delete`（一括削除）が FOLDER_TREE で効かない** — フェーズ11 の監査で検出した同型の未修正。一括操作バーの
   「削除」ボタンは動くのに `Delete` キーは効かず、ボタンとキーで不整合がある。**破壊的操作**であり、ツリー上の
   `Delete` に「フォルダを削除」という別解釈の余地もあるため、独断で有効化せずユーザー判断待ちとした。
2. **`Ctrl/Cmd+A`（全件選択）が FOLDER_TREE で効かない** — 同上（非破壊）。
   - 1・2 とも修正は「共通ブロックへ移す」1箇所で揃う。上記 `isShortcutEnabled` の切り出しと併せて実施すると
     再発防止まで一度に片付く。
3. **`docs/ideas/keyboard-first-navigation.md:76`** に旧仕様「端では何もしない」が残存。壁打ち成果物（当時の検討記録）
   のため意図的に更新していない。永続ドキュメント（`functional-design.md` / `product-requirements.md`）は更新済み。
4. **`docs/product-requirements.md` の「検索ボックス**(起動直後のフォーカス位置)**」** が U11 以降の実態
   （既定は左ペイン）と乖離している。本単位のスコープ外のため未修正。
