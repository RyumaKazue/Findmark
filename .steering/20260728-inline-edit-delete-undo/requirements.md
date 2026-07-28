# 要求内容 — U10 inline-edit-delete-undo

## 概要

検索結果の行から**別画面に移らずに**リネーム / URL編集 / 削除を完結できるようにする。編集はモーダルではなく行をその場で展開する**インライン編集**（デザイン状態1d）とし、削除は **UndoManager + Toast による5秒の即時アンドゥ**で保護する。

## 背景

Findmark の中核価値のひとつは「**検索結果の場で完結する整理**」（PRD「プロダクトコンセプト」）である。U7〜U9 で「探して開く」「別名を付ける」は成立したが、**見つけた行を直す・捨てる**手段が存在せず、結果行は読み取り専用のままになっている。

また `docs/development-guidelines.md`「Findmark 固有のルール」は **破壊的操作（削除・移動）には必ずアンドゥ手段を伴わせる**ことを規約化しており、削除機能を入れるには同時に `UndoManager` を導入する必要がある。本単位は削除の第1防御層（即時アンドゥ5秒・メモリ）を担い、第2防御層のゴミ箱（30日・`storage.local`）は U16 が担う。

- 引用元:
  - PRD 機能4「その場で編集・整理」（`docs/product-requirements.md`）
  - PRD「キーボードショートカット一覧 > 編集・整理(LISTモード)」`F2 / Ctrl+E`・`Delete`（同上）
  - PRD 非機能要件「破壊的操作は必ずアンドゥ手段を伴い、**そのアンドゥ手段自体もキーボードで発動できる**」「削除・移動を含む全操作でデータ損失ゼロ」（同上）
  - PRD「未確定の論点 > キーボード手段が未定義の操作」#1 アンドゥ（優先度が高いと明記）/ #5 インライン編集のタイトル⇄URL間移動（同上）
  - functional-design「UndoManager(即時アンドゥ)」コンポーネント設計（`docs/functional-design.md`）
  - functional-design「UC-5: 削除 → ゴミ箱 → 復元」シーケンス図と整合ルール（同上）
  - functional-design「編集モードのキー挙動」INLINE_EDIT 行（同上）
  - `docs/design/README.md`「1d — インライン編集中（リネーム / URL）」（視覚仕様の正）
  - architecture.md レイヤー依存「UI → サービス → データ」/ 即時アンドゥの位置づけ
  - repository-structure.md `InlineEdit.tsx` / `Toast.tsx` / `useUndo.ts` / `undo/UndoManager.ts` の配置

## 実装対象の機能

### 1. UndoManager（サービスレイヤー・`packages/shared/lib/undo/`）

- functional-design の契約どおり `register(action: UndoableAction)` / `undoLatest(): Promise<void>` を実装する。
- 保持は**1件のみ**（最新のアクションが直前のアクションを置き換える）。メモリ保持で永続化しない。
- `expiresAt`（now + 5000ms）を過ぎたアクションは `undoLatest()` で実行せず破棄する。期限到達時は自動で破棄し購読者へ通知する。
- React / DOM / chrome API に非依存の純粋クラスとし、UI へは `subscribe(listener)` で状態を配る。

### 2. 検索索引のインクリメンタル更新（`SearchEngine`）

- リネーム / URL変更 / 削除 / アンドゥ復元を、索引の**全再構築なしに**メモリ内へ反映する（U9 の `updateAliases` と同じ思想）。
- 追加 API: `updateNode(id, patch)` / `removeNode(id)` / `addNode(node, folderPath, aliases)`。
- 索引を更新しないと編集直後の結果行が古い値のままになるため、本単位に必須。

### 3. インライン編集（`InlineEdit.tsx` + `inlineEditModel.ts`・デザイン状態1d）

- 行を展開し、**タイトル入力と URL 入力を同時に**表示する（モーダルを使わない）。
- 入口: `F2` / `Ctrl(Cmd)+E`（既存 `resolveShortcutIntent`）、行のダブルクリック、ホバー時に現れる編集アイコン。
- 確定: `Enter`、および**編集フォーム全体からフォーカスが外れたとき**（フォーカスアウト確定）。
- 破棄: `Escape` の明示操作のみ。
- **タイトル⇄URL 間の移動は `Tab` / `Shift+Tab`**（PRD 未確定論点 #5 の解消）。`↑↓` はネイティブのキャレット移動のまま。
- URL が不正なときは**赤枠 + 行の下にインラインエラー**を表示し、確定できない（Enter・フォーカスアウトのいずれでも保存されない）。
- 編集中は他行 `opacity: 0.4`、ヘッダーと左ペインは `opacity: 0.45`（デザイン状態1d）。
- 保存は `BookmarkService.rename` / `updateUrl`。タイトルと URL のうち**変化したフィールドのみ**を更新する。

### 4. 削除 + 即時アンドゥ（`useRowActions.ts` / `useUndo.ts` / `Toast.tsx`）

- 入口: 右ペインにフォーカスがあるときの `Delete` キー、ホバー時に現れる削除アイコン。
- 削除は `BookmarkService.remove` と `AliasStore.remove` を**必ず同時に行う**（functional-design「整合ルール」: 別名だけ残る/消えるを防ぐ）。
- 削除後、`UndoManager` にアンドゥアクションを登録し、**5秒間のトースト**「「{タイトル}」を削除しました [元に戻す]」を表示する。
- アンドゥは削除前に退避した **フォルダパス・タイトル・URL・別名**から `ensureFolderPath` + `create` + `AliasStore.upsert` で再作成する（UC-5 の「5秒以内に元に戻す」経路）。
- **アンドゥはキーボードでも発動できる**（`Ctrl(Cmd)+Z`）。PRD 非機能要件「アンドゥ手段自体もキーボードで発動できる」を満たすため、本単位で `Ctrl(Cmd)+Z` を定義する（PRD 未確定論点 #1 の解消）。
- 破壊的操作が chrome API で失敗した場合は UI 状態をロールバックし、トーストでエラーを通知する（development-guidelines「エラーハンドリング」）。

### 5. 永続ドキュメントへの反映

本単位で確定させる仕様を `docs/` 側へ反映する（永続ドキュメントを正とする原則）。

- `docs/product-requirements.md`: 「編集・整理(LISTモード)」ショートカット一覧に `Ctrl/Cmd+Z`（アンドゥ）を追加。「キーボード手段が未定義の操作」表から #1（アンドゥ）と #5（タイトル⇄URL間移動）を解消済みとして落とす。
- `docs/functional-design.md`: 「編集モードのキー挙動」INLINE_EDIT 行に `Tab`（タイトル⇄URL）を追記し、`Ctrl/Cmd+Z` によるアンドゥ発動を明記。

## 受け入れ条件

> 出典: `docs/mvp-development-flow.md` U10 行「受け入れ基準」=「インラインでリネーム/URL編集 / URL不正で確定不可+インラインエラー / 削除が5秒アンドゥ付き」。以下はこれを検証可能な粒度へ分解したもの。

### インライン編集（リネーム / URL編集）

- [ ] `F2` / `Ctrl(Cmd)+E` / 行のダブルクリック / ホバーの編集アイコンで、選択行がインライン編集（状態1d）に入る。
- [ ] 編集行にタイトル入力と URL 入力が**同時に展開表示**され、モーダルは出ない。
- [ ] タイトルを書き換えて `Enter` すると `BookmarkService.rename` が呼ばれ、結果行の表示が即座に新しいタイトルになる。
- [ ] URL を書き換えて `Enter` すると `BookmarkService.updateUrl` が呼ばれ、索引にも反映される。
- [ ] 変化していないフィールドに対しては chrome API を呼ばない。
- [ ] 編集フォーム全体からフォーカスが外れると確定する（フォーカスアウト確定）。**タイトル⇄URL 間の移動では確定・離脱しない**。
- [ ] `Escape` を押すと変更が破棄され、元の値のまま LIST へ戻る。
- [ ] `Tab` / `Shift+Tab` でタイトル入力と URL 入力の間をキーボードだけで移動できる。
- [ ] 編集中は他の結果行が dimmed（`opacity: 0.4`）、ヘッダーと左ペインが `opacity: 0.45` になる。

### URL バリデーション

- [ ] 不正な URL（パースできない / スキームがない）を入力すると入力枠が赤枠になり、行の下にインラインエラーが表示される。
- [ ] 不正な URL のままでは `Enter` でもフォーカスアウトでも**確定されない**（chrome API が呼ばれず、編集モードにとどまる）。
- [ ] `javascript:` / `data:` スキームは不正として拒否する。
- [ ] URL を空にした場合も不正として拒否する。

### 削除と即時アンドゥ

- [ ] 右ペインにフォーカスがある状態で `Delete` を押すと選択行が削除される。**検索ボックスにフォーカスがある間の `Delete` は文字の前方削除のまま**でブックマークを削除しない。
- [ ] ホバー時に現れる削除アイコンのクリックでも削除できる。
- [ ] 削除時に `BookmarkService.remove` と `AliasStore.remove` の両方が呼ばれる。
- [ ] 削除後にトースト「「{タイトル}」を削除しました [元に戻す]」が表示され、**5秒後に自動で消える**。
- [ ] 5秒以内に `[元に戻す]` をクリックすると、元のフォルダ・タイトル・URL・別名でブックマークが復元され、結果一覧に再表示される。
- [ ] 5秒以内に `Ctrl(Cmd)+Z` を押しても同じアンドゥが発動する（キーボードのみで完結する）。
- [ ] 5秒を過ぎたあとの `Ctrl(Cmd)+Z` はアンドゥを発動しない（トーストが消えた後は対象なし）。
- [ ] 削除された行は即座に検索結果から消え、選択行は範囲内にクランプされる。

### UndoManager（ユニットテスト）

- [ ] `register` → `undoLatest` でアクションの `undo()` が1回だけ実行される。
- [ ] `expiresAt` を過ぎたあとの `undoLatest` は `undo()` を実行しない。
- [ ] 2回 `register` すると最新のアクションのみが保持される（アンドゥは1段）。
- [ ] `subscribe` した購読者へ登録・実行・期限切れの各タイミングで通知が届く。

### 品質ゲート

- [ ] `pnpm test` / `pnpm lint` / `pnpm type-check` がすべてパスする。
- [ ] UI から `chrome.*` を直接呼んでいない（`packages/storage` 経由）。
- [ ] 外部通信コード（`fetch` / XHR / WebSocket）を追加していない。

## 成功指標

- 検索結果の行から、別画面に移らずリネーム・URL編集・削除の3操作が完結する（PRD 機能4 のユーザーストーリー充足）。
- 削除操作がデータ損失につながらない（即時アンドゥで100%復元でき、キーボードのみでも発動できる）。
- `packages/shared` に追加する `UndoManager` がユニットテストで担保され、U12（移動）・U13（一括操作）がそのまま再利用できる。

## スコープ外

以下はこのフェーズでは実装しません:

- **ゴミ箱（30日保持）への退避と復元** — U16 trash。本単位は即時アンドゥ（第1層）のみ。`useRowActions` の削除処理に U16 が `TrashStore.push` を差し込める構造にとどめる。
- **フォルダ移動とそのアンドゥ** — U12 folder-move-dnd（`Ctrl+M` / D&D）。`UndoManager` は本単位で用意するが、移動アクションの登録は U12 が行う。
- **一括削除・一括操作を1アンドゥ単位で扱うこと** — U13 multi-select-bulk。
- **インライン編集フォーム内での別名編集（デザイン1dの項目3「別名チップ列」）** — 別名編集は U9 の `AliasEditor`（状態1e）が担う。同じ機能を2つの UI に二重実装しないため、インライン編集フォームには別名列を含めない。
- **フォルダ自体のリネーム・削除** — 右ペインはブックマークのみを扱う。
- **左ペインのキーボード操作・スコープ追従** — U11 folder-scope-tree。

## 参照ドキュメント

- `docs/mvp-development-flow.md` — U10 行（受け入れ基準・主な対象領域・依存 U4/U8）
- `docs/product-requirements.md` — 機能4、キーボードショートカット一覧、非機能要件、未確定の論点 #1/#5
- `docs/functional-design.md` — UndoManager、UC-5（削除→ゴミ箱→復元）、編集モードのキー挙動
- `docs/design/README.md` — 状態1d、結果行の共通仕様、Design Tokens
- `docs/architecture.md` — レイヤー依存、即時アンドゥ
- `docs/repository-structure.md` — `InlineEdit.tsx` / `Toast.tsx` / `useUndo.ts` / `undo/UndoManager.ts`
- `docs/development-guidelines.md` — コーディング規約、エラーハンドリング、Findmark 固有のルール
