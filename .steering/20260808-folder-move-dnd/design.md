# 設計 — U12 folder-move-dnd

## 方針

- レイヤー依存（UI → サービス → データ）を厳守する。chrome API は既存の `BookmarkService.move` に閉じ、UI は `useRowActions.moveRow` 経由でのみ移動を起こす。
- 破壊的操作の**移動は削除（U10）と同じ骨格**で実装する: データ層呼び出し → 索引メモリ内更新 → `refresh()` → `UndoManager.register`。`useRowActions` に `moveRow` を追加し、`Popup` の肥大化を防ぐ。
- **テスト可能な純粋ロジックを分離**する（既存の `folderTreeModel` / `inlineEditModel` / `virtualization` に倣う）。DnD の座標判定・パネルの絞り込みは pure module（`dragModel.ts` / `movePanelModel.ts`）に出し単体テストする。DOM/ポインタ結線（`useDragAndDrop.ts`）は薄く保つ。
- キー意味論は既存 `modeMachine` の PANEL/DRAG インテントをそのまま使う（新規のキー割り当てを増やさない）。

## コンポーネント / モジュール構成

### データ層: `SearchEngine.moveNode`（`packages/shared/lib/search/SearchEngine.ts`）

```ts
/** 索引上のエントリの所属フォルダを更新する（同期・U12）。id 不一致なら何もしない。 */
moveNode(id: string, parentId: string, folderPath: string[]): void {
  const entry = this.entries.find(e => e.node.id === id);
  if (!entry) return;
  entry.node = { ...entry.node, parentId };
  entry.folderPath = folderPath;
  entry.nFolders = folderPath.map(f => this.normalizer.normalizeText(f));
}
```

- `updateNode`（title/url）と同じ「id 一致 → 部分更新」パターン。`node` は spread でコピーし共有参照の破壊を避ける。
- 別名は URL に紐付くため移動では触らない（`aliases`/`nAliases` は不変）。

### サービス層: `useRowActions.moveRow`（`pages/popup/src/hooks/useRowActions.ts`）

```ts
moveRow(item, targetFolderId, targetFolderPath): Promise<void>
```

- 元 `parentId = item.node.parentId`、元 `folderPath = item.folderPath` を退避。
- `targetFolderId === originalParentId` なら no-op（同じ親への移動は無意味）。
- `await bookmarkService.move(id, targetFolderId)` → `searchEngine.moveNode(id, targetFolderId, targetFolderPath)` → `refresh()`。
- `register("「${title}」を移動しました", undo)`。undo は `bookmarkService.move(id, originalParentId!)` → `searchEngine.moveNode(id, originalParentId!, originalFolderPath)` → `refresh()`。
- 失敗時は `setError('移動できませんでした')`、索引・アンドゥは触らない。
- 既存 `commitEdit`/`deleteRow` と同じ `UseRowActionsApi` に追加する。

### 純粋モデル1: `movePanelModel.ts`（`pages/popup/src/components/`）

左ペインと同じ `FolderTreeNode[]` を候補へ変換する純粋関数群。

```ts
interface MoveCandidate { id: string; title: string; path: string[]; disabled: boolean; }

/** ツリーを深さ優先でフラット化し、各フォルダを候補にする。currentParentId は disabled。 */
buildMoveCandidates(folders: FolderTreeNode[], currentParentId: string | null): MoveCandidate[]

/** 正規化部分一致でフィルタ（Normalizer 注入）。空クエリは全件。末尾フォルダ名 or フルパスに一致。 */
filterCandidates(candidates: MoveCandidate[], query: string, normalize: (s: string) => string): MoveCandidate[]

/** ↑↓ の候補インデックス移動（端でクランプ）。 */
clampIndex(index: number, length: number): number
```

- `path` は `findFolderPath` 由来（root からのタイトル配列）。表示は ` / ` 結合。
- disabled（現在の親）は候補に残してグレーアウト表示し、**確定時に弾く**（存在を隠さない）。

### 純粋モデル2: `dragModel.ts`（`pages/popup/src/components/`）

DnD の座標・しきい値判定。DOM 非依存。

```ts
const DRAG_THRESHOLD_PX = 5;
const AUTOSCROLL_EDGE_PX = 40;
const SPRING_LOAD_MS = 600;

/** 開始点からの移動が 5px を超えたか（ユークリッド距離）。 */
exceedsThreshold(start: {x:number;y:number}, current: {x:number;y:number}): boolean

/** ペイン矩形と現在 Y からオートスクロール方向を返す（-1 上 / 1 下 / 0 なし）。 */
autoScrollDirection(rect: {top:number;bottom:number}, y: number): -1 | 0 | 1

/** ドロップ先フォルダが有効か（存在し、かつ現在の親でない）。 */
isValidDropTarget(folderId: string | null, currentParentId: string | null): boolean
```

### UI: `MovePanel.tsx`（`pages/popup/src/components/`）

- 中央オーバーレイのパネル（design のパネル寸法・トークンに準拠。`bg` 白 / radius 8 / 影・focus ring はトークン）。
- 上部: フォルダ絞り込み `<input>`（オープン時 autofocus）。下部: 候補リスト（スクロール、選択行ハイライト、disabled はグレーアウト + 「現在の場所」注記）。
- `onKeyDown` で `resolveKeyIntent('PANEL', e)` を解決:
  - `panel:candidate-up`/`down` → `clampIndex`
  - `panel:confirm` → 選択候補が非 disabled なら `onConfirm(candidate)`、disabled なら何もしない
  - `panel:close` → `onClose()`
- 候補クリックでも確定（マウス代替）。パネルは自前 input を持つため検索ファーストに奪われない（`isSearchFirstExempt('PANEL')`）。
- Props: `folders`, `currentParentId`, `onConfirm(folderId, folderPath)`, `onClose`。

### UI: `DragGhost.tsx`（`pages/popup/src/components/`）

- `position: absolute` の浮遊カード（design 1g）。`left/top` はカーソル座標、`rotate(-1.5deg)`、白地 + 実線境界 + 影、`opacity 0.94`。
- 中身: `Favicon` + タイトル（ellipsis）+ 件数バッジ（accent 塗り・白・monospace。値は `count`）。
- Props: `title`, `url`, `count`, `x`, `y`。`Popup` のルート（`position: relative`）配下に描画する。

### フック: `useDragAndDrop.ts`（`pages/popup/src/hooks/`）

DnD の状態と DOM 結線を集約する薄い層。

- state: `dragging`（対象 item）、`ghostPos`（x,y）、`dropTargetId`。
- `onRowMouseDown(item, e)`: 開始点を記録し `document` に `mousemove`/`mouseup` を張る。5px 超で `enterDrag(id)` して DRAG 開始。
- `mousemove` 中: ゴースト位置更新、`document.elementFromPoint` で `[data-folder-id]` を判定 → `isValidDropTarget` で `dropTargetId` を更新。左ペイン矩形で `autoScrollDirection` を評価し `requestAnimationFrame` ループでスクロール。スプリングロード: 同じ閉じたフォルダ上に 600ms 留まったら `expand(folderId)`。
- `mouseup`: 有効な `dropTargetId` があれば `onDrop(item, folderId)`、無ければ中止。後始末（リスナー解除・state クリア・`exitToList`）。
- `Escape`（keydown, DRAG 中のみ）で中止。
- 依存注入: `enterDrag`, `exitToList`, `onDrop`, `expand`（`folderTreeActionsRef` 経由）。ドロップ判定は `document` の `data-folder-id` から引くため ref 不要。

## 既存コンポーネントへの結線

### `FolderTreeItem.tsx`

- フォルダ行のスコープ選択 `<button>` に `data-folder-id={folder.id}` を付与（`elementFromPoint` のドロップ判定用）。
- `dropTarget` prop を追加し、真のとき破線ハイライト（`ring`/`border-dashed` トークン）。
- 「すべて」行・「さらに N 件」行はドロップ対象外（`data-folder-id` を付けない）。

### `FolderTree.tsx`

- `dropTargetId` prop を受け取り、該当行に `dropTarget` を渡す。
- `FolderTreeActions` に `expand(id: string)` を追加し、`useDragAndDrop` のスプリングロードがキーボードと同じ命令ハンドル経由で展開する（内部モデルの一貫性）。

### `ResultRow.tsx` / `ResultList.tsx`

- `ResultRow` に `onDragStart?: (e: MouseEvent) => void` を追加し、行の `<button>` の `onMouseDown` に配線（編集/削除アイコン・別名エリア上の mousedown は既存クリック分岐を優先）。編集中（`editingInline`/`editingAlias`）の行はドラッグ不可。
- `ResultList` は `onRowMouseDown?: (index, e)` を中継する。

### `Popup.tsx`

- `Ctrl+M`: 既存 `resolveShortcutIntent(e) === 'panel'` を LIST 分岐に追加し、`results.length > 0` なら `exitToList()` → `enterPanel()`（対象は `selectedIndex`）。
- `mode === 'PANEL'`: `MovePanel` を描画。`currentParentId = results[selectedIndex]?.node.parentId ?? null`。`onConfirm` で `rowActions.moveRow(item, folderId, folderPath)` → `focusSearch()`。`onClose` で `focusSearch()`。対象行が消えたら effect で `exitToList`（別名/インラインと同じ穏当復帰パターン）。
- `useDragAndDrop` を配線。`DragGhost` を `mode === 'DRAG' && dragging` のとき描画。`onDrop` は `moveRow`、`folderPath` は `findFolderPath(folders, folderId)`。
- `FolderTree` に `dropTargetId` を渡す。

## 主要な設計判断

1. **索引の部分更新（`moveNode`）で結果に残す**: 全再構築だとスコープ・選択が飛ぶ。`updateNode` と同じ思想で `folderPath`/`parentId` のみ差し替え、`refresh()` で表示だけ更新する（AC-6）。移動後にスコープが元フォルダのままなら `inScope`（新 parentId 判定）で結果から外れるのは仕様どおり（人為的に splice しない）。
2. **PANEL のキーはパネル内で自己完結**: Popup の document リスナーは LIST/FOLDER_TREE のみを処理する既存構造を崩さない。AliasEditor/InlineEdit と同じく、自前 input を持つモードは自コンポーネントでキー解決する。
3. **スプリングロード/展開を `actionsRef.expand(id)` に集約**: マウス（D&D）とキーボードが同じ命令ハンドルで展開状態を更新し、内部モデルの一貫性を保つ（U11 の設計思想の踏襲）。
4. **DRAG モードで検索ファースト無効化**: `isSearchFirstExempt` に `'DRAG'` を追加する（U8 で「後続単位が DRAG/PANEL を担う」と明記された前方互換ヘルパの完成）。ドラッグ中の誤入力で検索ボックスへ飛ばないようにする。`modeMachine.test.ts` を更新する。
5. **現在の親の無効化は「選択可・確定で弾く / ドロップ判定で弾く」**: MovePanel は候補に残してグレーアウト（存在を隠さない）、D&D は `isValidDropTarget` でハイライトも移動も抑止（AC-3）。

## テスト方針（development-guidelines「テスト戦略」）

- `SearchEngine.moveNode`: 既存 `SearchEngine` テストに追記。移動後に folderPath 更新・スコープ判定が新親で動く・id 不一致 no-op。
- `movePanelModel`: `buildMoveCandidates`（フラット化・disabled 付与）、`filterCandidates`（正規化部分一致・空クエリ）、`clampIndex`。
- `dragModel`: `exceedsThreshold`（5px 境界）、`autoScrollDirection`（上端/下端/中央）、`isValidDropTarget`（null / 現在の親 / 別フォルダ）。
- DnD の DOM 結線（`useDragAndDrop`）は pure model に切り出した以外を薄くし、ユニットテストは model に集約する（既存方針: DOM 依存の重いフックは model テストで担保）。
