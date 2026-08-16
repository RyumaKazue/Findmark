# タスクリスト — selection-mode

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

## フェーズ1: 純粋モデル（ロジックの単一の正）

- [x] `selectionModel.ts` に選択モードを導入する
  - [x] `SelectionState` に `active: boolean` を追加し、`emptySelection` を `active: false` にする
  - [x] `activate` / `deactivate` / `toggleActive` を追加する（`deactivate` は ids・anchor もクリア）
  - [x] `toggle` / `rangeTo` / `selectAll` が常に `active: true` を返すようにする（不変条件 `ids>0 ⇒ active`）
  - [x] `clear` は ids・anchor のみクリアし `active` を保つことを doc コメントで明示する
  - [x] 末尾の export に新規関数を追加する
- [x] `selectionModel.test.ts` を拡充する
  - [x] `emptySelection` が非アクティブであること
  - [x] `toggle` / `rangeTo` / `selectAll` が `active: true` を立てること
  - [x] 最後の1件を `toggle` で外しても `active` が true のままであること
  - [x] `clear` が `active` を保ち、`deactivate` が全初期化すること
  - [x] `toggleActive` の ON→OFF（ids 破棄）/ OFF→ON（ids 保持）
- [x] `modeMachine.ts` の `ShortcutContext` に `selectionMode` を追加する
  - [x] `isShortcutEnabled`: 選択モード中は `inline-edit` / `alias-edit` を無効にする
  - [x] `isShortcutEnabled`: 選択モード中の `delete` / `panel` を「選択件数 > 0」に限定する（検索欄の `delete` 無効は従来どおり）
  - [x] 判定理由を doc コメントに追記する（誤爆で行が消える事故の防止）
- [x] `modeMachine.test.ts` に選択モード分岐のテストを追加する
  - [x] 既存ケースが `selectionMode: false` で従来どおり通ること
  - [x] 選択モード中の各 intent の有効/無効

## フェーズ2: React フック層

- [x] `useSelection.ts` を改訂する
  - [x] `selectionMode` / `exitSelectionMode` / `toggleSelectionMode` を `UseSelectionApi` に追加する
  - [x] `useCallback` で安定参照にする（Popup の effect 依存配列に入るため）
  - [x] `enterSelectionMode` を公開しない理由を doc コメントに書く

## フェーズ3: i18n

- [x] `packages/i18n/locales/ja/messages.json` に `popupSelectionModeEnter` / `popupSelectionModeExit` を追加する
- [x] `packages/i18n/locales/en/messages.json` に同キーを追加する（キー順を ja と揃える）

## フェーズ4: UI コンポーネント

- [x] `SearchHeader.tsx` に選択モード切替ボタンを追加する
  - [x] props `selectionMode` / `onToggleSelectionMode` を追加する
  - [x] 「＋追加」の左に h34 のトグルボタンを配置する（OFF=白地+枠 / ON=accent 塗り）
  - [x] `aria-pressed` と ON/OFF で出し分けた `title` を付ける
- [x] `ResultRow.tsx` から左のチェックボックス導線を撤去する
  - [x] `data-checkbox-area` のクリック分岐を削除する
  - [x] ホバーでチェックボックスを出す `group-hover` 表示を削除する
  - [x] `handleMouseDown` の除外セレクタから `[data-checkbox-area]` を外す
- [x] `ResultRow.tsx` を選択モード仕様にする
  - [x] props `selectionActive` を `selectionMode` に改名する
  - [x] `handleClick` の先頭で選択モードを早期分岐する（Shift=範囲選択 / それ以外=トグル・開かない）
  - [x] 選択モード中はファビコンを描画せず、表示専用チェックボックス（`pointer-events-none`）に置換する
  - [x] 選択モード中は ✎ / 🗑 アイコンを描画しない
  - [x] 選択モード中は `onDoubleClick`（インライン編集）を無効にする
  - [x] 通常モードの `Ctrl/Cmd+クリック` / `Shift+クリック` 分岐は維持する（自動遷移のため）
- [x] `ResultList.tsx` の `selectionActive` を `selectionMode` に置き換えて各行へ流す
- [x] `BulkActionBar.tsx` の `onClear` の doc コメントを「選択解除＋選択モード終了」に更新する

## フェーズ5: Popup への結線

- [x] `useSelection()` の分解に `selectionMode` / `exitSelectionMode` / `toggleSelectionMode` を追加する
- [x] ヘッダーを差し替える
  - [x] `SearchHeader` に `selectionMode` / `onToggleSelectionMode` を渡す
  - [x] `BulkActionBar` の `onClear` を `exitSelectionMode` に変更する
- [x] `ResultList` へ `selectionMode` を渡す（`selectionActive={selectionCount > 0}` を置換）
- [x] キーボードを整合させる
  - [x] `isShortcutEnabled` の文脈に `selectionMode` を渡す
  - [x] `Escape` の前段条件を `selectionCount > 0` から `selectionMode` に変え、`exitSelectionMode()` を呼ぶ
  - [x] `list:open` の実行を「選択モード中は選択トグル」に分岐する（検索欄・右ペイン双方）
  - [x] `useEffect` の依存配列を更新する
- [x] 一括操作の完了で選択モードを終了する
  - [x] `handleBulkDelete`
  - [x] `handleBulkMoveConfirm`
  - [x] `performMove`（D&D の一括移動経路）
- [x] クエリ / スコープ変更時の `clearSelection()` はそのまま（モード維持）であることを確認し、コメントを更新する

## フェーズ6: 品質チェックと修正

- [x] `pnpm test`（フォアグラウンド実行で exit code 0）
- [x] `pnpm lint`（`--continue` のため各パッケージの結果と最終 exit code を確認）
- [x] `pnpm type-check`（exit code 0）
- [x] `implementation-validator` サブエージェントによる品質検証を実施し、指摘を解消する

## フェーズ7: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] requirements.md の AC-1〜AC-11 と実装を突き合わせ OK/NG を一覧化する
- [x] ユーザーに検証結果を提示し、受け入れ承認（ゲート2）を取得する
  - NG があった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ8: ドキュメント更新・振り返り（モード4）

- [x] `docs/functional-design.md` の「チェックボックスの段階表示」表を選択モード仕様へ改訂する
- [x] `docs/functional-design.md` の「デザイン/初期案からの変更点」表に本単位の判断を追記する
- [x] `docs/design/README.md` の 1f（表示条件）と操作一覧（行のチェックボックス→選択モード）を改訂する
- [x] 本ファイル下部に振り返りを記録する

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

**なし**（ラウンド0）。ゲート2（受け入れ承認）を1回で通過した。AC-1〜AC-11 はすべて OK、NG 0件。
`implementation-validator` の指摘（必須0件 / 推奨2件 / 提案2件）のうち、コードに関わる2件は承認前に反映済み:
- `Popup.tsx` の `handleToggleSelect` のコメントが旧用語「チェックボックス」のままだった → 新語彙へ更新
- `selectionModel.test.ts` の不変条件テストが `cond ? x : true` の自明な assertion になっていた → `filter` で対象を絞る形へ

---

## 実装後の振り返り

### 実装完了日
2026-08-15

### 計画と実績の差分

**計画と異なった点**:
- ほぼ計画どおり。design.md に書いた設計（`active` を `selectionModel` に持たせ、`clear`/`deactivate` を分ける）をそのまま実装でき、方針変更は発生しなかった。
- 計画に無かった追加が1点: `ResultRow` の行 `<button>` に `aria-pressed={selectionMode ? checked : undefined}` を付けた。選択モード中の行は「遷移するボタン」ではなく「トグル」に意味が変わるため、支援技術へ状態を伝える必要があると実装中に気づいた（チェックボックス自体は装飾＝`aria-hidden` にしたため、これが無いと選択状態が読み上げから消える）。
- 同様に計画外の細部として、選択モード中は「＋別名」の破線チップも非表示にした（押しても編集に入らないのに押せそうに見えるため）。

**新たに必要になったタスク**:
- なし（タスクの追加・分割は発生しなかった）。

**技術的理由でスキップしたタスク**:
- なし。全タスクを完了した。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: **0**
- 主な不一致と分類: なし（AC-1〜AC-11 すべて OK）
- `implementation-validator` 評価: スペック準拠 / コード品質 / テスト / セキュリティ / パフォーマンス すべて 5、ブロッカー0件
- 品質ゲート: `pnpm test` 399 tests passed（popup 227 を含む）/ `pnpm lint` / `pnpm type-check` すべて exit code 0（フォアグラウンド実行で確認）
- 受け入れ承認: 2026-08-15 取得

### 学んだこと

**技術的な学び**:
- **「UI のモード」を UI 層の flag ではなく状態モデルの一部として持つと、危険な中間状態を型と不変条件で消せる**。本単位では「選択があるのに通常モード（＝クリックでサイトが開く）」が最悪の不整合であり、これは修正しようとしていたバグそのものの再発を意味した。`toggle`/`rangeTo`/`selectAll` がすべて `active: true` を返すという規則をモデルに置いたことで、呼び出し側に「入ってから選ぶ」順序を書く余地が無くなり、書き忘れによる再発経路が構造的に消えた。`useSelection` が `enterSelectionMode` を**公開しない**のも同じ意図。
- **「終了」と「クリア」を別の関数に分けたことが、4つある終了導線の一貫性を保証した**。`clear`（ids のみ・モード維持＝クエリ/スコープ変更用）と `deactivate`（全部捨てる＝終了導線用）を分けたことで、「Escape だけ選択が残る」「一括削除後だけモードが残る」といった経路ごとのブレが起きようがない。
- **誤操作の原因が「小さすぎるターゲット」ではなく「同じ面の中に意味の境界があること」だった**。チェックボックスを大きくする方向の改善では、境界が動くだけで誤操作は残っていた。モードで面全体の意味を切り替えると境界そのものが消える。
- `modeMachine` のような純粋なキー意味論の層には、アプリ状態（選択モード）を引数として足さない方が良い。`Enter`＝「フォーカス行を活性化」という意味は不変で、活性化が「開く」か「選ぶ」かの**解釈**だけを状態を持つ層（Popup）に置くと、`resolveKeyIntent` の全モードに無関係な引数が伝播するのを避けられる。一方で「ショートカットが有効か」は状態依存の判断なので `isShortcutEnabled` の文脈に加えるのが自然だった。この2つの線引きが今回いちばん迷った箇所。

**プロセス上の改善点**:
- 着手前に4つの論点（入口の位置 / 選択の見せ方 / 操作後の挙動 / 修飾キーの扱い）をユーザーに確認し、requirements.md の「決定事項」表に固定したことで、実装中に判断で止まる場面が無かった。UI の作り替えは設計の分岐が多く、この事前確認の費用対効果が高い。
- 一方で「選択モード中に検索できるか（ヘッダーが一括操作バーに差し替わる条件）」「選択モード中の Delete の扱い」は事前確認に含めておらず、design.md で自分の判断として明文化したうえで承認前に提示した。同種の「モードを増やす」変更では、**既存 UI の他の要素がそのモード中どうなるか**を論点リストに最初から入れておくとよい。

### 次回への改善提案
- モードを追加する変更では、着手前に「そのモード中、既存の各操作（編集・削除・ドラッグ・検索・ショートカット）がどうなるか」を一覧表にしてから設計に入ると、AC の網羅性が上がる（今回は AC-9 としてまとめたが、設計中に洗い出したもので、要件段階では抜けていた）。
- `useSelection` のようなフックの API は「公開しない関数」を意識的に決めると安全性が上がる。次回も「この操作を外から呼べる必要が本当にあるか」を各 export について問う。
- 本単位は UI の触感が本質だが、自動テストで担保できるのは純粋モデルまでだった。手動確認の観点（行のどこを押しても開かない / ホバーで何も出ない）を tasklist に**チェック項目として書いておく**と、受け入れ時の確認漏れを防げる。
