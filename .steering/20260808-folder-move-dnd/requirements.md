# 要求内容 — U12 folder-move-dnd

## 概要

検索結果の行を**別画面に移らずに別フォルダへ移動**できるようにする。移動手段は2系統:

1. **キーボード（必須）**: `Ctrl(Cmd)+M` で **MovePanel**（フォルダ選択パネル・PANEL モード）を開き、フォルダ名を絞り込み入力 → `↑↓` で候補移動 → `Enter` で確定。
2. **ドラッグ&ドロップ**: 結果行全体を **5px 以上ドラッグ**で開始（DRAG モード）、ゴースト表示、左ペインのフォルダへドロップ。閉じたフォルダの自動展開（スプリングロード 600ms）・ペイン端 40px のオートスクロール・`Escape`/ペイン外ドロップで中止。

移動は `chrome.bookmarks.move` を即時実行し、**5秒の即時アンドゥ**（U10 の `UndoManager` + `Toast`）で保護する（development-guidelines「破壊的操作（削除・移動）には必ずアンドゥ手段を伴わせる」）。移動しても検索結果から消さず、**フォルダパス表示だけを更新**する。

## 背景

Findmark の中核価値のひとつは「**検索結果の場で完結する整理**」（PRD「プロダクトコンセプト」）である。U10 で「直す・捨てる」（リネーム/URL編集/削除）は完結したが、**見つけた行を別フォルダへ移す**手段が無い。functional-design「デザイン非採用項目」でもフォルダ移動はクリック（一括操作バー）でしか到達できない未対応項目として挙がっている。本単位はキーボード（MovePanel）と D&D の両方で移動を成立させる。

破壊的操作である移動は U10 の即時アンドゥ層（`UndoManager`・5秒・メモリ）を再利用して保護する。第2防御層のゴミ箱（U16）は移動には不要（移動はデータ削除を伴わない）。複数選択による一括移動は U13 の担当で、本単位は**単一行の移動**に閉じる（`moveRow` を将来の一括呼び出しへ拡張しやすい形にする）。

- 引用元:
  - PRD 機能7「フォルダ移動(キーボード + ドラッグ&ドロップ)」（`docs/product-requirements.md`）
  - PRD「キーボードショートカット一覧」`Ctrl+M`（移動・フォルダ選択パネル）（同上）
  - PRD 非機能要件「破壊的操作は必ずアンドゥ手段を伴い、**そのアンドゥ手段自体もキーボードで発動できる**」「削除・移動を含む全操作でデータ損失ゼロ」（同上）
  - functional-design「UC-3: フォルダ移動(アンドゥ付き)」シーケンス図（`docs/functional-design.md`）
  - functional-design「画面遷移図」`LIST → PANEL: Ctrl+M` / `LIST → DRAG: 行を5px以上ドラッグ` / `DRAG → LIST: ドロップ / Escape(中止)`、「編集モードのキー挙動」DRAG・PANEL 行（同上）
  - `docs/design/README.md`「1g — ドラッグ&ドロップ中」ゴースト視覚仕様・`DragGhost` / `FolderTree`（dropTargetId）コンポーネント（視覚仕様の正）
  - architecture.md レイヤー依存「UI → サービス → データ」（chrome API はデータ層 `BookmarkService.move` に閉じる）
  - repository-structure.md `MovePanel.tsx` / `hooks/useDragAndDrop.ts` の配置

## 実装対象の機能

### 1. 検索索引の移動反映（`SearchEngine.moveNode`）

- 移動を索引の**全再構築なしに**メモリ内へ反映する（U9 `updateAliases` / U10 `updateNode` と同じ思想）。
- 追加 API: `moveNode(id, parentId, folderPath)` — 対象エントリの `node.parentId` を更新し、`folderPath` / `nFolders`（正規化フォルダ名）を差し替える。`id` 不一致なら何もしない。
- これにより移動後に `refresh()` すると、フォルダパス表示が更新され、スコープ（`parentId` 一致）の判定も新しい親で行われる。

### 2. 移動オーケストレーション（`useRowActions.moveRow`）

- `moveRow(item, targetFolderId, targetFolderPath)` を追加する。
- 手順（UC-3）: 元 `parentId`（`item.node.parentId`）・元 `folderPath`（`item.folderPath`）を退避 → `BookmarkService.move(id, targetFolderId)` → `SearchEngine.moveNode(id, targetFolderId, targetFolderPath)` → `refresh()` → `register("「…」を移動しました", undo)`。
- アンドゥは元の `parentId` へ `move` し戻し、索引を元 `folderPath` へ戻して `refresh()` する。
- 移動先が現在の親と同一なら **no-op**（何もしない・アンドゥも登録しない）。
- 失敗時は索引・アンドゥを触らずエラートーストのみ（実データと表示の乖離を作らない）。

### 3. MovePanel（`MovePanel.tsx` + `movePanelModel.ts`・PANEL モード）

- 入口: `Ctrl(Cmd)+M`（既存 `resolveShortcutIntent` の `'panel'`）。選択行を対象にする。
- フォルダ名の**絞り込み入力**（正規化部分一致）→ 候補リスト。候補は左ペインと同じフォルダ集合を**フラット化**し、各候補にフルパス（`findFolderPath`）を添える。
- キーボード: `↑↓` 候補移動 / `Enter` 決定 / `Escape` 閉じる（`resolveKeyIntent('PANEL', e)` に準拠）。パネルは自前の input を持つため、キー処理は**パネル内で自己完結**する（`isSearchFirstExempt('PANEL')` により検索ボックスへ奪われない）。
- **現在の親フォルダはグレーアウトして無効化**（選択・決定不可）。
- 確定で `moveRow` を呼び、`LIST` へ戻る。対象行が消えた場合は穏当に閉じる。

### 4. ドラッグ&ドロップ（`useDragAndDrop.ts` + `dragModel.ts` + `DragGhost.tsx`・DRAG モード）

- 結果行の `mousedown` から **5px 以上**移動で DRAG 開始（`dragModel.exceedsThreshold`）。開始時に `enterDrag(id)`。
- **ゴースト**（`DragGhost`）: カーソル追従の浮遊カード（ファビコン + タイトル + 件数バッジ。design 1g の視覚仕様に準拠。単一行のため件数=1）。
- ドロップ先は**左ペインのフォルダのみ**。ホバー中のフォルダを破線ハイライト（`dropTargetId`）。**現在の親フォルダは無効**（ドロップ不可）。
- **スプリングロード**: 閉じたフォルダに **600ms** ホバーで自動展開。
- **オートスクロール**: 左ペイン上下端 **40px** にゴーストが入ると自動スクロール（`dragModel` で方向を算出）。
- 中止: `Escape` / 左ペイン外へのドロップで移動せず終了（`drag:cancel`）。
- 有効なフォルダへドロップで `moveRow` を呼ぶ。ドロップ／中止後は `LIST` へ戻す。

### 5. Popup / 既存コンポーネントへの結線

- `Popup.tsx`: `Ctrl+M`（`shortcutIntent === 'panel'`）で選択行を対象に `enterPanel`。`mode === 'PANEL'` のとき `MovePanel` を描画。`useDragAndDrop` を配線し、`DragGhost` を描画。移動系は `useRowActions.moveRow` を利用。
- `ResultRow` / `ResultList`: 行をドラッグソースにする（`onMouseDown` フック）。
- `FolderTree` / `FolderTreeItem`: ドロップ先属性（`data-folder-id`）とドロップ先ハイライト（`dropTargetId`）を受ける。

## 受け入れ基準

`docs/mvp-development-flow.md` U12 行および PRD 機能7・functional-design UC-3 を出典とする。

- [ ] **AC-1（キーボード移動）**: `Ctrl(Cmd)+M` で MovePanel が開き、フォルダ名の絞り込み → `Enter` で移動できる（キーボードだけで完結する）。［PRD 機能7 / mvp-flow U12「キーボードとD&Dの両方で移動」］
- [ ] **AC-2（D&D 移動）**: 結果行を **5px 以上**ドラッグで開始し、ゴーストが表示され、左ペインのフォルダへドロップで移動できる。［PRD 機能7 / mvp-flow U12］
- [ ] **AC-3（現在の親を無効化）**: MovePanel でも D&D でも、**現在の親フォルダはグレーアウト/無効**で選択・ドロップできない。［PRD 機能7 / mvp-flow U12「現在の親は無効化」］
- [ ] **AC-4（スプリングロード / オートスクロール / 中止）**: 閉じたフォルダに **600ms** ホバーで自動展開、左ペイン上下端 **40px** でオートスクロール、`Escape`／ペイン外ドロップで中止する。［PRD 機能7］
- [ ] **AC-5（即時実行 + 5秒アンドゥ）**: 移動は `chrome.bookmarks.move` を即時実行し、トーストで「元に戻す」を **5秒**提供する。アンドゥで元フォルダへ戻る。［PRD 機能7 / mvp-flow U12「5秒アンドゥ」／非機能要件］
- [ ] **AC-6（結果に残しパス更新）**: 「すべて」表示・検索結果表示では、移動しても行は消さず**フォルダパス表示だけ更新**する。**特定フォルダにスコープを当てている**ときに、そのフォルダ**外**へ移動した行は、スコープの直下表示ルール（`parentId === scope.folderId`）に従い一覧から外れる（＝そのフォルダから取り出した挙動。2026-08-08 ユーザー確認で確定。詳細は functional-design UC-3 の注記）。［PRD 機能7 / mvp-flow U12「移動しても結果から消えずパス更新」 + U6a スコープ仕様との整合］
- [ ] **AC-7（品質ゲート）**: `pnpm test` / `pnpm lint` / `pnpm type-check` が通る。追加ロジック（`moveNode` / `movePanelModel` / `dragModel`）にユニットテストがある。

## スコープ外（本単位に含めない）

- **複数選択による一括移動**（U13）。本単位は単一行の移動に閉じる（`moveRow` は将来の一括化に拡張しやすい形にする）。
- フォルダ内の並び順変更（MVP 対象外）。
- ゴミ箱連携（移動はデータ削除を伴わないため不要）。
