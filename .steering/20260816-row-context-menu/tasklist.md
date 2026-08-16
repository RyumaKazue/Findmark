# タスクリスト — row-context-menu

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース
実装方針・アーキテクチャ・依存関係の変更により、タスク自体が技術的に不要/実行不能になった場合のみ。
スキップ時は `- [x] ~~タスク名~~（理由: 具体的な技術的理由）` の形式で記録する。

---

## フェーズ1: メニューコンポーネントの汎用化

- [x] `FolderContextMenu.tsx` を `ContextMenu.tsx` へ改名する
  - [x] エクスポート名を `ContextMenu` / `ContextMenuActions` / `MenuItem` に変更する
  - [x] doc コメントから「フォルダ行の」という限定を外す（フォルダ/行の共用であることを明記）
  - [x] `Popup.tsx` の import と型参照を追従させる（フォルダ側が壊れないことを型で確認）
- [x] `MenuItem` に `separatorBefore` を追加する
  - [x] 該当項目の上に `role="separator"` の区切り線を描く
  - [x] `clampPosition` の高さ見積りに区切り線の分を足す

## フェーズ2: 純粋モデル（rowMenuModel）

- [x] `pages/popup/src/components/rowMenuModel.ts` を新規作成する
  - [x] `RowMenuKey` 型（`edit` / `alias-edit` / `move` / `delete`）
  - [x] `canOpenRowMenu(ctx)`: 選択モード中・対象行なしでは false
  - [x] `buildRowMenuItems()`: 並び順と `danger` / `separatorBefore` を返す（ラベルは持たない）
  - [x] 宣言は非 export・末尾で export をまとめる（既存 pure module の規律）
- [x] `rowMenuModel.test.ts` を新規作成する
  - [x] `canOpenRowMenu` の3ケース（通常＋対象あり / 選択モード / 対象なし）
  - [x] `buildRowMenuItems` の順序・`delete` の `danger` と `separatorBefore`・他項目が非 danger

## フェーズ3: i18n

- [x] `ja` / `en` に `popupRowMenuEdit` / `popupRowMenuAliasEdit` / `popupRowMenuMove` を追加する
- [x] 参照元が無くなる `popupRowEdit` / `popupRowDelete` を削除する（✎／🗑 のツールチップ専用だったため）
  - [x] 削除前に grep で参照が残っていないことを確認する
  - [x] `popupRowAliasEdit` / `popupRowAddAlias` は**残す**（別名エリアを存置するため）

## フェーズ4: 行コンポーネントの整理

- [x] `ResultRow.tsx` から行内の押下対象を撤去する
  - [x] ✎／🗑 アイコンの描画と `data-row-action` のクリック分岐を削除する
  - [x] `onDelete` prop を削除する（`onEnterAliasEdit` は別名エリア存置のため残す）
  - [x] `handleMouseDown` の除外セレクタから `[data-row-action]` のみ外す（`[data-alias-area]` は残す）
  - [x] 別名チップ領域（`data-alias-area`）と「＋別名」チップは**現状維持**であることを確認する
- [x] `ResultRow.tsx` に右クリックを追加する
  - [x] props `onContextMenu`（座標を親へ通知）を追加し、`e.preventDefault()` する
  - [x] 選択モード中は通知しない（Popup 側でも `canOpenRowMenu` で二重に防ぐ）
- [x] `ResultList.tsx` を追従させる
  - [x] `onRowContextMenu`（index + 座標）を追加して各行へ中継する
  - [x] 不要になった `onDeleteRow` props を削除する（`onEnterAliasEdit` は残す）

## フェーズ5: Popup への結線

- [x] `folderAction` を `contextAction` へ改名し、`row-menu` variant を追加する
  - [x] 既存 variant を `folder-menu` / `folder-confirm` へ改名する
  - [x] 参照箇所（排他条件・キー処理・描画）をすべて追従させる
- [x] 行の右クリック受信ハンドラを追加する（`canOpenRowMenu` で抑止 → `exitToList` + `enterPanel`）
- [x] 行メニューの実行を既存ハンドラへ結線する
  - [x] `edit` → `enterInlineEditAt(index)`
  - [x] `alias-edit` → `enterAliasEditAt(index)`
  - [x] `move` → `setSelectedIndex(index)` + `exitToList()` + `enterPanel()`
  - [x] `delete` → `handleDeleteAt(index)`
- [x] `closeFolderAction` を `closeContextAction` に改名し、行メニューからは右ペインへフォーカスを戻す
- [x] PANEL のキー処理を `contextAction.kind` で分岐させる（メニュー2種は同じ命令ハンドルを共用）
- [x] `ResultList` へ `onRowContextMenu` を渡し、削除済み props の受け渡しを外す
- [x] `useEffect` の依存配列を更新する

## フェーズ6: 品質チェックと修正

- [x] `pnpm test`（フォアグラウンド実行で exit code 0）
- [x] `pnpm lint`（`--continue` のため各パッケージの結果と最終 exit code を確認）
- [x] `pnpm type-check`（exit code 0）
- [x] `implementation-validator` サブエージェントによる品質検証を実施し、指摘を解消する

## フェーズ6.5: 修正ラウンド1（検証ログ ラウンド1・分類A）

- [x] 行メニューの `delete` で `exitToList()` を経由させる（PANEL に留まり MovePanel が誤って開くのを止める）
- [x] `ConfirmDialog.tsx` / `Popup.tsx` の doc コメントに残る `FolderContextMenu` を `ContextMenu` へ更新する
- [x] `ResultRow.tsx` から不要になった `group` クラスを削除する（`group-hover` の消費者が無くなったため）
- [x] 品質ゲート（test / lint / type-check）を再実行する

## フェーズ7: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] requirements.md の AC-1〜AC-11 と実装を突き合わせ OK/NG を一覧化する
- [x] 手動確認の観点をチェックリストとして提示する（`folder-delete` の反省を反映）
- [x] ユーザーに検証結果を提示し、受け入れ承認（ゲート2）を取得する
  - NG があった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ8: ドキュメント更新・振り返り（モード4）

- [x] `docs/design/README.md` の操作一覧・結果行の共通仕様・コンポーネント表を改訂する
- [x] `docs/functional-design.md` の結果行の操作導線（ホバーアイコン前提の記述）を改訂する
- [x] 本ファイル下部に振り返りを記録する

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

- ラウンド1（2026-08-16・`implementation-validator` の指摘）
  - 不一致内容: 行メニューの「削除」を実行すると、直後に**無関係な行を対象とした「フォルダへ移動」パネルが開く**。
    メニューは `exitToList(); enterPanel();` で PANEL に入るが、`delete` ケースだけ `mode` を変える経路を通らないため
    PANEL のまま残り、`contextAction === null` になった時点で `movePanelItem`（= `results[selectedIndex]`）が
    非 null になって MovePanel の描画条件が成立していた。`edit`/`alias-edit` は各ハンドラ内の `exitToList()` で、
    `move` は明示的な `exitToList()` で抜けており、`delete` だけが規律から外れていた。
  - 分類: **A（実装欠陥）** — 設計（design.md「いずれも PANEL から抜けるため `exitToList()` を経由する」）どおりに
    実装できていなかった。要件・設計の前提は正しい。
  - 戻り先: モード2（実装ループ・フェーズ6.5 を追加）
  - 対応: `delete` ケースに `exitToList()` を追加。あわせて doc コメントの旧名参照2箇所と、
    消費者が無くなった `group` クラスを整理。

---

## 実装後の振り返り

### 実装完了日
2026-08-16

### 計画と実績の差分

**計画と異なった点**:
- 設計どおり。`ContextMenu` への汎用化・`rowMenuModel` の切り出し・`contextAction` ユニオンへの variant 追加は、いずれも計画から変更なく実装できた。
- 計画に無かった小さな追加が2点（検証で判明）: ✎/🗑 の削除に伴って不要になった `group` クラスの除去と、doc コメントに残った旧名 `FolderContextMenu` の追従。
- 要件の修正が1点。当初は別名チップ領域のクリックも廃止する案を出したが、ユーザー判断で**存置**に変更した（決定事項5）。理由も requirements に記録済み。

**新たに必要になったタスク**:
- フェーズ6.5（修正ラウンド1）を追加。検証エージェントが見つけた「削除で MovePanel が誤って開く」バグの修正。

**技術的理由でスキップしたタスク**:
- なし。全タスクを完了した。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: **1**（分類A: 実装欠陥。設計・要件の作り直しは不要）
- `implementation-validator` 評価: スペック準拠3/コード品質4（**必須指摘1件**）。指摘はすべて対応済み
- **必須指摘の内容**: 行メニューの `delete` だけ `exitToList()` を経由せず PANEL に留まり、削除直後に無関係な行の MovePanel が開いていた
- 品質ゲート: `pnpm test` 255 tests（popup）/ `pnpm lint` / `pnpm type-check` すべて exit code 0
- 受け入れ承認: 2026-08-16 取得

### 学んだこと

**技術的な学び**:
- **「同じ状態から抜ける」処理は、分岐ごとに書くと必ず1つ漏れる**。今回の必須バグはまさにそれで、メニューの4項目のうち `delete` だけが LIST への復帰を通っていなかった。`edit`/`alias-edit` は呼び先のハンドラが内部で `exitToList()` していて「たまたま」正しく、`move` は明示していたため、**漏れているケースだけが例外的に静かに壊れた**。分岐の前に一度だけ `exitToList()` を通す（あるいは `closeContextAction()` を必ず経由する）構造なら、原理的に起こらなかった。「共通の後始末は分岐の外に出す」という基本を、モード遷移にも適用すべきだった。
- **PANEL モードの相乗りが増えると、"抜け忘れ"の影響が可視化されにくくなる**。`mode === 'PANEL'` かつ `contextAction === null` という組み合わせが「MovePanel を開く条件」と一致してしまったのが今回の症状。状態の直交性が崩れている兆候であり、design.md に申し送っている `panelKind` ユニオンへの統合を実施すべき時期が近い。
- **ユーザーの判断が設計判断を上書きすることには一貫した価値がある**。別名チップの存置は、私の「行内に押下対象を残さない」という原則より、「押下範囲が狭く誤爆しにくい / 頻度が低い」という実利用に基づく判断が勝った。原則は根拠であって目的ではない、という良い例として記録しておく。

**プロセス上の改善点**:
- 受け入れ提示の際に手動確認チェックリストを添えるようにした（前単位の反省）。今回はそれに加えて、**検証エージェントが見つけたバグの再現条件（「右クリックした行 ≠ フォーカス行」）をチェックリストに明記**できた。バグの発見条件をそのまま確認手順に落とすのは効果が高い。
- 一括改名（`folderAction` → `contextAction`）を機械的な文字列置換で行った結果、無関係な `folderActions`（`useFolderActions` の戻り値）まで巻き込んだ。すぐ気づいて戻したが、**部分文字列を含む識別子がある改名は、置換前に grep で影響範囲を数えるべき**だった。

### 次回への改善提案
- **モード（PANEL 等）に入る処理を書いたら、抜ける処理を分岐の外に1つだけ置く**。今回のバグは、この一点を守れば発生しなかった。
- 次に PANEL 用途を足す単位では、着手前に `panelKind` ユニオンへの統合リファクタを行う（`bulkMovePanel` / `addCurrentPanelOpen` / `contextAction` の3系統を1つに）。今回のバグは「PANEL に留まっていること」が別の描画条件と衝突した結果であり、同型の事故は用途が増えるほど起きやすい。
- 一括改名は `grep -c` で件数を確認し、意図した件数と一致することを確かめてから実行する。
