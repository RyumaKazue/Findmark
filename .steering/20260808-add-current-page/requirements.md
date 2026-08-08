# 要求内容 — U14 add-current-page

## 概要

ポップアップのヘッダー右「＋追加」（または `Ctrl(Cmd)+D`）で、**今見ているタブのページ**を即座にブックマーク登録し、続けて編集パネル（`AddCurrentPanel`）を開く。パネルではタイトル・保存先フォルダ（絞り込み検索付き）・別名を編集でき、各フィールドは変更のたび個別に即時保存される。既に同一URLが登録済みなら新規作成せず「★ 登録済み」を示して既存の登録を編集パネルで開く。パネルを閉じても（ポップアップ自体が閉じても）登録は残る。

## 背景

Findmark の中核導線は「検索して開く」だが、PRD 機能9はその逆方向 —「今見ているページを流れを止めずに保存する」— を担う。U9（別名編集UI）・U11（フォルダスコープ・ツリー）が完成し、U4 の `BookmarkService`（`getCurrentTab`/`create`/`getFolderPath`/`ensureFolderPath`）と U10/U12 で確立した「破壊的操作には即時アンドゥを伴わせる」オーケストレーション（`useRowActions`）が揃ったことで、本単位は**新規作成**という文脈だけを追加すればよい。

ストレージ設計は U4 時点で既に前方互換的に用意されている: `LocalState.lastUsedFolderId`（`packages/storage/lib/types.ts`）と `localStateStore.setLastUsedFolder()`（`packages/storage/lib/impl/localStateStore.ts`）が実装済みで、本単位はこれを**初めて使用する**。

- 引用元:
  - PRD 機能9「現在のページをブックマーク登録」（`docs/product-requirements.md`）
  - PRD「キーボードショートカット一覧」`Ctrl+D`（現在のページを追加）（同上）
  - functional-design「インタラクティブ操作フロー(現在ページ登録)」（`docs/functional-design.md`）
  - functional-design「ファイル構造(ストレージ上のキー設計)」`last_used_folder_id`（同上）
  - development-guidelines「Findmark 固有のルール」破壊的操作(削除・移動)には必ずアンドゥ手段を伴わせる
  - architecture.md レイヤー依存「UI → サービス → データ」
  - repository-structure.md `AddCurrentPanel.tsx` の配置

**デザイン非該当**: `docs/design/` にはこの機能の視覚モックが存在しない（1a〜1g のいずれにも含まれない）。本単位のパネル UI は既存トークン（`MovePanel`/`AliasEditor` で確立済みの配色・角丸・影）に忠実に、新規にレイアウトを設計する。

## 実装対象の機能

### 1. データ層の追加メソッド（`BookmarkService`）

- `findByUrl(url: string): Promise<BookmarkNode | null>` を追加する。`chrome.bookmarks.search({ url })` を使い、既存登録の有無を判定する（重複登録防止）。

### 2. 現在ページ登録オーケストレーション（`useAddCurrent.ts`）

- `open(): Promise<boolean>`: `getCurrentTab()` → URL検証（`inlineEditModel.validateUrl` を再利用。`chrome://` 等は許可、`javascript:`/空URLは拒否）→ `findByUrl` で既存確認 → 既存なら「★登録済み」としてそのまま読み込み、無ければ `lastUsedFolderId`(無ければ既定書き込み先) へ即時 `create` し索引へ `addNode`。
- `updateTitle`/`updateFolder`/`updateAliases`/`remove` は既存の `useRowActions`（`commitEdit`/`moveRow`/`deleteRow`）を**合成テンプレート用の疑似 `SearchResultItem`** 経由で再利用し、破壊的操作（削除・移動）の即時アンドゥを無償で獲得する。
- `updateFolder` は移動と同時に `localStateStore.setLastUsedFolder(folderId)` を呼ぶ（次回の初期値に反映）。

### 3. 編集パネル（`AddCurrentPanel.tsx`）

- タイトル入力（フォーカスアウト確定。development-guidelines の他編集フィールドと同じ規律）。
- 保存先フォルダ: 絞り込み検索付きの選択UI（`movePanelModel` の純粋ロジックを再利用。現在の親を無効化しない＝どのフォルダも選び直せる）。
- 別名: 既存 `AliasEditor` をそのまま埋め込む（別名の確定/削除/上限は既存ロジックのまま）。
- 「★ 登録済み」バッジ（既存URLだった場合のみ表示）。
- `[削除]`（取り消し。5秒アンドゥ付き）/ `[完了]`（パネルを閉じる。登録は残る）。

### 4. モード結線（既存 PANEL モードの拡張・新規モード追加なし）

- U13 の `bulkMovePanel` フラグと同じ設計で `addCurrentPanel` フラグを追加し、既存の `PANEL` モードを共用する（`Mode`/`modeReducer`/`resolveKeyIntent` は変更しない）。Escape は Popup の document リスナー経由でパネルを閉じる（U12 で確立した「フォーカス位置に依らない document レベルの命令ハンドル方式」を踏襲し、背景の結果行が Enter/Escape を奪う不具合クラスを再発させない）。
- `modeMachine.resolveShortcutIntent` に `'add-current'`（`Ctrl(Cmd)+D`）を追加する。

### 5. ヘッダーの結線

- `SearchHeader` の「＋追加」ボタンにクリックハンドラを配線する（現状 U7 のプレースホルダ）。

## 受け入れ基準

`docs/mvp-development-flow.md` U14 行および PRD 機能9を出典とする。

- [ ] **AC-1（即時登録→編集パネル）**: ヘッダー右「＋追加」（または `Ctrl+D`）で即座に登録し、続けて編集パネルを開く。既に登録済みのURLなら新規作成せず「★ 登録済み」を表示して編集パネルを開く。［PRD 機能9］
- [ ] **AC-2（パネル編集）**: パネルでタイトル編集・保存先フォルダ選択(絞り込み検索付き)・別名付与ができる。［PRD 機能9］
- [ ] **AC-3（保存先初期値）**: 保存先フォルダの初期値は前回使用したフォルダ（`lastUsedFolderId`）。未使用時は既定書き込み先。［PRD 機能9］
- [ ] **AC-4（パネル閉でも登録維持）**: パネル操作中にポップアップが閉じても登録は残る（即時登録してから編集する設計のため）。［PRD 機能9］
- [ ] **AC-5（即時保存・削除・完了）**: 各フィールドは変更のたび個別に即時保存する。`[削除]`で登録取り消し（5秒アンドゥ付き）、`[完了]`でパネルを閉じる。［PRD 機能9 / development-guidelines 破壊的操作のアンドゥ必須］
- [ ] **AC-6（品質ゲート）**: `pnpm test` / `pnpm lint` / `pnpm type-check` が通る。

## スコープ外（本単位に含めない）

- URL自体の編集（AddCurrentPanel は新規登録・タイトル/フォルダ/別名のみを扱う。URL編集はU10のインライン編集で既存行に対して行う）。
- ゴミ箱（30日）連携（U16）。`[削除]` は即時アンドゥ（5秒）まで。
- `chrome://` 等の特殊ページでの登録可否の詳細な仕様変更（既存 `validateUrl` の許可/拒否をそのまま踏襲）。
