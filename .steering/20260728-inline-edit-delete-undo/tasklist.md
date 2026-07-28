# タスクリスト — U10 inline-edit-delete-undo

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

## フェーズ1: サービスレイヤー（UndoManager・索引更新）

- [x] `UndoManager` を実装する（`packages/shared/lib/undo/UndoManager.ts`）
  - [x] `UndoableAction` 型（`label` / `undo()` / `expiresAt`）と `UNDO_WINDOW_MS = 5000` を定義
  - [x] `register` / `undoLatest` / `peek` / `dismiss` / `subscribe` を実装
  - [x] 期限の二重チェック（`setTimeout` の自動破棄 + `undoLatest` 時の `Date.now()` 再判定）
  - [x] `register` 時の前タイマー `clearTimeout`、`undo()` reject 時の保持解除 + `console.error`
- [x] `UndoManager` のユニットテストを書く（`UndoManager.test.ts`）
  - [x] `register` → `undoLatest` で `undo()` が1回実行され保持が解除される
  - [x] 期限切れ後の `undoLatest` は `undo()` を実行しない（フェイクタイマー）
  - [x] 期限到達で自動破棄され購読者へ `null` が通知される
  - [x] 2回 `register` で最新のみ保持される（前のアクションは実行されない）
  - [x] `subscribe` が購読時に現在値を通知し、解除後は通知されない
  - [x] `undo()` が reject しても保持が解除される
- [x] `packages/shared` から `UndoManager` をエクスポートする
  - [x] `packages/shared/lib/undo/index.ts` を追加
  - [x] `packages/shared/index.mts` に再エクスポートを追加
- [x] `SearchEngine` に索引のインクリメンタル更新 API を追加する
  - [x] `updateNode(id, { title?, url? })`（`nTitle` を再計算）
  - [x] `removeNode(id)`
  - [x] `addNode(node, folderPath, aliases)`（正規化フィールドを構築）
  - [x] 存在しない ID を渡しても索引を壊さない防御
- [x] `SearchEngine` の索引更新テストを追記する（`SearchEngine.test.ts`）
  - [x] `updateNode` でタイトル変更 → 新タイトルでヒット・旧タイトルでヒットしない
  - [x] `updateNode` で URL 変更が反映される
  - [x] `removeNode` で検索結果から消える
  - [x] `addNode` で追加分が検索・ブラウズ結果に現れ、別名でもヒットする
  - [x] 存在しない ID 指定で例外を投げず既存エントリが無傷

## フェーズ2: popup の純粋ロジック（inlineEditModel・modeMachine）

- [x] `inlineEditModel.ts` を実装する（`pages/popup/src/components/`）
  - [x] `validateUrl`（空 / パース不能 / `javascript:` / `data:` を不正、その他スキームは許可）
  - [x] `planCommit`（`invalid` / `unchanged` / `update{title?,url?}` を返す。タイトルは `trim` して比較）
- [x] `inlineEditModel` のユニットテストを書く（`inlineEditModel.test.ts`）
  - [x] `validateUrl`: 正常 URL / 空文字 / 空白のみ / スキームなし / `javascript:` / `data:` / `chrome://`
  - [x] `planCommit`: 差分なし / タイトルのみ / URL のみ / 両方 / URL 不正
  - [x] `planCommit`: タイトルの前後空白だけの変更は `unchanged` になる
- [x] `modeMachine.ts` を拡張する
  - [x] `ShortcutIntent` に `'delete'` / `'undo'` を追加し `SHORTCUTS` に追記
  - [x] `resolveShortcutIntent` で `Delete`（修飾なし）と `Ctrl/Cmd+Z`（Shift なし）を解決
  - [x] `resolveKeyIntent` の第3引数 `listFocus` を省略可能にする（既定 `'search'`）
- [x] `modeMachine` のテストを追記する（`modeMachine.test.ts`）
  - [x] `Delete` → `'delete'` / `Ctrl+Z` → `'undo'` / `Ctrl+Shift+Z` → `null`
  - [x] 既存の `F2` / `Ctrl+E` / `Ctrl+;` / `Ctrl+M` が退行していない
  - [x] `resolveKeyIntent('INLINE_EDIT', e)` が第3引数省略でも `inline:confirm` / `inline:discard` / `none` を返す

## フェーズ3: popup のフック層（services・useSearch・useUndo・useRowActions）

- [x] `services.ts` に `undoManager` の単一インスタンスを追加する
- [x] `useSearch.ts` に `refresh()` を追加し、`updateAliases` を `refresh` 経由へ整理する
- [x] `useUndo.ts` を実装する（`pages/popup/src/hooks/`）
  - [x] `subscribe` 購読 + 現在値の初期通知で `pending` を state 化
  - [x] `register(label, undo)`（`expiresAt` を内部付与）/ `undoLatest` / `dismiss`
- [x] `useRowActions.ts` を実装する（`pages/popup/src/hooks/`）
  - [x] `commitEdit(item, plan)`: `rename` / `updateUrl` を変化フィールドのみ実行 → `updateNode` → `refresh`
  - [x] `deleteRow(item)`: 退避データ組み立て（U16 接続点をコメント明示）→ `remove` → `aliasStore.remove` → `removeNode` → `refresh`
  - [x] アンドゥ登録: `ensureFolderPath` → `create` → `upsert` → `addNode` → `refresh`
  - [x] 失敗時の `error` 設定 + `console.error`（削除失敗時は索引を触らない）

## フェーズ4: popup の UI コンポーネント

- [x] `Toast.tsx` を実装する
  - [x] `message` / `actionLabel` / `onAction` / `onDismiss` / `tone`
  - [x] `role="status"` `aria-live="polite"`、フォーカスを奪わない
  - [x] デザイントークン準拠（下端中央・`danger` トーン）
- [x] `InlineEdit.tsx` を実装する（デザイン状態1d）
  - [x] タイトル入力（h34・accent 枠 + focus ring）と URL 入力（h32・monospace）を同時展開
  - [x] マウント時にタイトル入力へフォーカス + 全選択
  - [x] `Enter` 確定 / `Escape` 破棄（`resolveKeyIntent('INLINE_EDIT', e)` 経由・`stopPropagation`）
  - [x] フォーカスアウト確定（`relatedTarget` がフォーム外のときのみ。`Tab` での内部移動では確定しない）
  - [x] URL 不正で赤枠 + 行下インラインエラー、確定不可
  - [x] 保存 / キャンセルボタン（マウス手段）
- [x] `ResultRow.tsx` を変更する
  - [x] `editingInline` のとき `InlineEdit` を描画
  - [x] `dimmed`（編集中の非対象行 `opacity-40`）を適用
  - [x] ホバー時に右端へ編集 / 削除アイコンをフェードイン（`data-row-action` + `closest()` 分岐）
  - [x] `onDoubleClick` でインライン編集に入る
- [x] `ResultList.tsx` を変更する
  - [x] `editingInlineId` / `dimmed` / `onEnterInlineEdit` / `onCommitEdit` / `onCancelEdit` / `onDeleteRow` を中継
  - [x] 編集行の高さ上乗せを別名編集（80px）とインライン編集（140px）で出し分ける

## フェーズ5: Popup の結線

- [x] `Popup.tsx` にインライン編集を結線する
  - [x] `INLINE_EDIT` の対象行解決（`mode.targetId` → `results`）と対象消失時の `exitToList`
  - [x] `resolveShortcutIntent === 'inline-edit'` → `enterInlineEditAt(selectedIndex)`
  - [x] 確定 / 破棄後に LIST へ戻し検索ボックスへフォーカス復帰
  - [x] `INLINE_EDIT` 中はヘッダー・左ペインを `opacity-45`
- [x] `Popup.tsx` に削除とアンドゥを結線する
  - [x] `'delete'` は `listFocus === 'result'` のときのみ発火（検索ボックスの前方削除を奪わない）
  - [x] `'undo'` は `pending` があるときのみ `preventDefault` + `undoLatest`
  - [x] `Toast` の描画（`pending` → アンドゥ / `error` → danger）

## フェーズ6: 永続ドキュメントの更新

- [x] `docs/product-requirements.md` を更新する
  - [x] 「編集・整理(LISTモード)」ショートカット一覧に `Ctrl/Cmd+Z`（アンドゥ）を追加
  - [x] 機能4 の受け入れ条件にタイトル⇄URL の `Tab` 移動を明記
  - [x] 「キーボード手段が未定義の操作」表から #1（アンドゥ）・#5（タイトル⇄URL間移動）を解消済みとして削除し、番号を整理
- [x] `docs/functional-design.md` を更新する
  - [x] 「編集モードのキー挙動」INLINE_EDIT 行に `Tab`（タイトル⇄URL）を追記
  - [x] `Ctrl/Cmd+Z` によるアンドゥ発動（トースト表示中のみ有効）を明記
  - [x] UC-5 の即時アンドゥが U10 で実装済みであることを反映

## フェーズ7: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `pnpm test`（12 tasks successful・shared 75件・popup 87件）
- [x] リントエラーがないことを確認
  - [x] `pnpm lint`（`--force` で全19パッケージ再実行・15 tasks successful・0 errors）
- [x] 型エラーがないことを確認
  - [x] `pnpm type-check`

## フェーズ8: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.mdの各要件）と実装を突き合わせOK/NGを一覧化（全項目OK。詳細はユーザー提示メッセージ参照）
- [x] 手動検証項目を提示（自動テスト対象外の UI 導線）
  - [x] ~~編集 → 索引反映 → 再検索でヒットする~~（未実施: ユーザーはコードレビュー・単体テスト結果に基づき受け入れ承認。実ブラウザでの手動検証はChrome拡張のロードを要し本セッションでは実行できないため提示のみ）
  - [x] ~~URL 不正で赤枠 + エラー、確定不可~~（同上）
  - [x] ~~削除 → トースト → `[元に戻す]` / `Ctrl+Z` で別名ごと復元~~（同上）
  - [x] ~~削除 → 5秒待機 → トースト消滅 → `Ctrl+Z` が無反応~~（同上）
- [x] ユーザーに検証を依頼
- [x] 受け入れ承認（ゲート2）を取得（2026-07-28・ユーザー応答「OK」）
  - NGがあった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る → 今回NGなし

## フェーズ9: ドキュメント更新・振り返り（モード4）

- [x] `docs/mvp-development-flow.md` の「進捗」表で U10 を完了に更新
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

- ステップ6（`implementation-validator`）で「必須修正」は0件、「推奨」3件を検出。いずれも実装欠陥（分類A）にあたる技術的なギャップであり、要件・設計の前提崩れではないため、計画の再承認（ゲート1）なしにその場で修正した。
  - `useRowActions.commitEdit`: URL変更時に旧URLの`AliasStore`レコードが孤児化する問題 → URL変更成功時に旧別名を`aliasStore.remove`する処理を追加。
  - `useRowActions.commitEdit`: タイトル/URL同時変更で片方失敗時に索引が実データと乖離する問題 → フィールドごとに成功時点で`searchEngine.updateNode`を呼ぶよう変更。
  - `Popup.tsx`: `Ctrl/Cmd+Z`のモード非依存な乗っ取りが編集フォーム内のネイティブUndoと衝突する懸念 → `isSearchFirstExempt(currentMode)`で自前の文字入力UIを持つモード（INLINE_EDIT/ALIAS_EDIT/PANEL）を除外。
  - 修正後、`pnpm test`/`pnpm lint`/`pnpm type-check`を再実行し全てパスを確認。

---

## 実装後の振り返り

### 実装完了日
2026-07-28

### 計画と実績の差分

**計画と異なった点**:
- 設計(design.md)通りに実装したが、実装完了後の`implementation-validator`検証で3件の技術的ギャップが見つかり、その場で修正した（下記「検証の要約」参照）。design.mdの各コンポーネント設計自体に誤りはなく、実装の詳細レベルでの見落としだった。
- `resolveKeyIntent`の第3引数`listFocus`を省略可能にする変更は計画通りだったが、副次的に`Ctrl/Cmd+Z`の乗っ取り条件に`isSearchFirstExempt(currentMode)`を組み合わせる形で活用することになり、既存の検索ファースト判定ロジックを別の目的（アンドゥの乗っ取り制御）にも再利用する結果になった。設計時点では想定していなかった応用だが、既存のモード分類をそのまま再利用できたため新規の判定ロジックは不要だった。

**新たに必要になったタスク**:
- なし。tasklist.mdに計画したフェーズ1〜9の範囲内で完結した。

**技術的理由でスキップしたタスク**:
- なし。全タスクを実装した。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 0（`implementation-validator`による指摘は全て分類A「実装欠陥」で、計画の再承認なしにその場で修正したため、正式な「検証→戻る」ラウンドとしてはカウントしていない）
- `implementation-validator`が検出した推奨事項3件（いずれも分類A・実装欠陥、要件・設計の前提崩れではない）:
  1. `useRowActions.commitEdit`: URL変更時に旧URLの`AliasStore`レコードが孤児化する → 修正済み
  2. `useRowActions.commitEdit`: タイトル/URL同時変更で片方失敗時に索引が実データと乖離する → フィールドごとの反映に変更
  3. `Popup.tsx`: `Ctrl/Cmd+Z`のモード非依存な乗っ取りが編集フォーム内のネイティブUndoと衝突しうる → `isSearchFirstExempt`で除外
- 受け入れ承認: 2026-07-28（ユーザー応答「OK」）。ユーザーは実ブラウザでの手動検証は行わず、コードレビュー・単体テスト結果（`pnpm test`/`lint`/`type-check`全パス）に基づき承認した。

### 学んだこと

**技術的な学び**:
- 検索索引（`SearchEngine`）へのインクリメンタル更新（`updateNode`/`removeNode`/`addNode`）を導入する際、「複数フィールドを1回のAPI呼び出しでまとめて更新し、成功後に1回だけ索引反映する」設計は、部分的な失敗（例: タイトル成功・URL失敗）で表示と実データが乖離するリスクを生む。フィールドごとに「chrome API成功 → 即座に索引反映」を対にする方が、失敗時の一貫性を保ちやすい。
- 別名（別テーブル）を持つエンティティのURL変更は、検索索引側だけでなく永続層（`AliasStore`）側のクリーンアップも対で考える必要がある。索引のメモリ内状態と`chrome.storage`の永続状態は別物であり、片方だけ更新すると孤児データが残る。
- 複数のキーボードショートカット（検索ファースト復帰・アンドゥの乗っ取り等）が同じ「自前の文字入力UIを持つモードでは奪わない」という判定基準を共有する場合、既存の`isSearchFirstExempt`のような汎用的なモード分類関数を再利用することで、新しい判定ロジックを増やさずに済む。

**プロセス上の改善点**:
- `implementation-validator`による検証を実装完了後・ユーザー受け入れ承認前に挟むフローが有効に機能した。ユーザーが実ブラウザでの手動テストを行わない前提（本セッションでは拡張機能をロードできない）でも、コードレベルの深い検証によって3件の実装欠陥を受け入れ承認前に検出・修正できた。
- 設計書（design.md）に「U16への接続点」のようにコメントで将来の後続単位向けフックを明示しておくと、実装時にその意図を見失わずに済んだ（`useRowActions.deleteRow`内の`TrashStore.push`挿入点コメント等）。

### 次回への改善提案
- U16（trash）着手時は、本単位で明示した「`remove`直前の`TrashStore.push`挿入点」を起点に設計する。
- U12（folder-move-dnd）・U13（multi-select-bulk）着手時は、本単位で実装した`UndoManager`をそのまま再利用できる（`register(label, undo)`のシグネチャに移動・一括操作のアンドゥ関数を渡すだけでよい）。
- 今後、複数のchrome API呼び出しを伴う編集系オーケストレーション（`useRowActions`のようなフック）を実装する際は、最初から「フィールドごとに成功時点で副作用（索引反映等）を実行する」設計を採用し、今回のような後追い修正を避ける。
