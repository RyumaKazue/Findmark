# 設計 — U13 multi-select-bulk

## 方針

- レイヤー依存（UI → サービス → データ）を厳守。一括操作の chrome API 呼び出しは既存 `BookmarkService`（`move`/`remove`/`create`/`ensureFolderPath`）に閉じ、`useRowActions` の一括版に集約する。
- 一括操作は**単一版（U10 delete / U12 move）と同じ骨格**（データ層 → 索引メモリ内更新 → `refresh` → `UndoManager.register`）を N 件へ拡張する。undo を**1件だけ登録**し、その中で全件を戻すことで「1アンドゥ単位」を実現する（`UndoManager` は変更不要）。
- 選択ロジックは純粋モデル（`selectionModel.ts`）へ分離し単体テストする（既存 `folderTreeModel`/`dragModel`/`movePanelModel` に倣う）。
- 選択状態はモード（`useMode`）・スコープ・`selectedIndex`（フォーカス）と**直交**。新規の `useSelection` フックで保持する。

## モジュール構成

### 純粋モデル: `selectionModel.ts`（`pages/popup/src/hooks/`）

```ts
interface SelectionState { ids: ReadonlySet<string>; anchorId: string | null }

const emptySelection: SelectionState;
toggle(state, id): SelectionState          // Ctrl/Cmd+クリック。ids をトグル、anchorId=id
rangeTo(state, targetId, orderedIds): SelectionState  // Shift+クリック。anchor..target を union（anchor 無し→単一選択）
selectAll(orderedIds): SelectionState      // Ctrl/Cmd+A。全 id を選択、anchor=先頭
clear(): SelectionState
isSelected(state, id): boolean
```

- `rangeTo`: `orderedIds` 内の anchor と target の index を求め、min..max を既存 ids に union。anchor は個別クリック時のみ更新（Gmail 準拠で range では更新しない）。
- すべて新しい `Set` を返す純粋関数（React の再レンダー検知のため参照を変える）。

### フック: `useSelection.ts`（`pages/popup/src/hooks/`）

- `useState<SelectionState>(emptySelection)`。
- 公開: `selectedIds`（`ReadonlySet<string>`）, `count`, `isSelected(id)`, `toggle(id)`, `rangeTo(id, orderedIds)`, `selectAll(orderedIds)`, `clear()`。
- 薄いラッパ（`selectionModel` を呼ぶだけ）。

### サービス層: `useRowActions` 拡張（一括版）

```ts
moveRows(items: SearchResultItem[], targetFolderId, targetFolderPath): Promise<void>
deleteRows(items: SearchResultItem[]): Promise<void>
```

- `moveRows`: 対象 = `items` のうち `node.parentId !== targetFolderId` の件。各件 `await bookmarkService.move` → `searchEngine.moveNode(id, target, targetFolderPath)`。全件処理後 `refresh()` 1回。undo1件登録（各件を元 `parentId`/`folderPath` へ戻して最後に `refresh`）。ラベル「N件を移動しました」。
- `deleteRows`: 各件 `remove`＋`aliasStore.remove`（失敗は握って継続）＋`searchEngine.removeNode`。`refresh()` 1回。undo1件（各件 `ensureFolderPath`→`create`→`aliasStore.upsert`→`searchEngine.addNode`、最後に `refresh`）。ラベル「N件を削除しました」。
- 退避データ（元 parentId/folderPath/aliases/title/url）は呼び出し時に `items` から収集してクロージャに保持（削除で index から消えても undo で使える）。単一版 `moveRow`/`deleteRow` と共有できる部分は小さいため、一括版は別関数として明快に書く（過度な抽象化はしない）。
- 部分失敗時: 途中まで成功した件は索引反映済み。エラートーストを出し、undo は成功済みの件のみを対象に登録する（実データと索引の整合を保つ）。

### UI: `BulkActionBar.tsx`（`pages/popup/src/components/`・デザイン 1f）

- Props: `count`, `onMove`, `onDelete`, `onClear`。
- レイアウト: `h-14`・bg `accent-bg`・下ボーダー・`justify-between`。左「N件選択中」（`accent-bar` 700 13px）。右3ボタン（h30, gap2）: [移動]（accent 塗り・白）/ [削除]（白地・危険色枠・危険色文字）/ [選択解除]（枠なしテキスト）。
- `SearchHeader` と同じ 56px 枠で差し替えるため、Popup は `header={ selection.count>0 ? <BulkActionBar…/> : <SearchHeader…/> }` とする。

### UI: `ResultRow` のチェックボックス段階表示（デザイン 1f・段階表示表）

- 追加 props: `selectionActive`（1件以上選択中＝全行常時表示）, `checked`, `onToggleSelect()`（チェックボックス/Ctrl クリック時）, `onRangeSelect()`（Shift クリック時）。
- ファビコン枠（16px）を、`checked || selectionActive` のとき**チェックボックス**に置換。それ以外は**ファビコン**を表示しつつ、`group-hover` 時のみチェックボックスをオーバーレイ表示（`pointer-events` もホバー時のみ有効化）。同寸・同角丸でレイアウト不動。
- チェックボックス: 選択済み = accent 塗り + 白 `✓`、未選択 = 白地 + 枠。`onClick` は行の open を発火させない（専用ハンドラで処理）。
- 行の `handleClick`: 先頭で修飾キー判定を追加。`e.metaKey||e.ctrlKey` → `onToggleSelect()`（開かない）。`e.shiftKey` → `onRangeSelect()`（開かない）。それ以外は既存分岐（編集/削除/別名/open）。
- 選択済み行の背景・チップ色は `selected`（フォーカス）とは別に `checked` で `bg-row-selected` を当てる（design 1f）。

### 結線: `ResultList`

- 中継 props 追加: `selectionActive`, `selectedIds`（各行 `checked` 判定）, `onToggleSelect(index)`, `onRangeSelect(index)`。
- 各 `ResultRow` に `checked={selectedIds.has(item.node.id)}` 等を渡す。

### 結線: `Popup.tsx`

- `const selection = useSelection();`。`orderedIds = results.map(r => r.node.id)`。
- ヘッダー差し替え: `selection.count>0 ? <BulkActionBar count onMove onDelete onClear/> : <SearchHeader/>`。
- 行クリック: `onToggleSelect(index)` → `selection.toggle(results[index].node.id)`。`onRangeSelect(index)` → `selection.rangeTo(id, orderedIds)`。
- `Ctrl/Cmd+A`: document リスナーで `resolveShortcutIntent(e)==='select-all'` かつ `currentMode==='LIST' && listFocus!=='search' && results.length>0` → `e.preventDefault(); selection.selectAll(orderedIds)`。検索ボックス入力中はネイティブ（テキスト全選択）に委ねる。
- 一括バー: [移動]→`openBulkMovePanel()`（`bulkMove=true` にして `enterPanel()`）/ [削除]→`deleteRows(selectedItems); selection.clear()` / [選択解除]→`selection.clear()`。
- MovePanel の一/多分岐: `bulkMove` state を持ち、`onConfirm` を `bulkMove ? bulkMoveConfirm : handleMoveConfirm`、`currentParentId` を `bulkMove ? null : movePanelItem.parentId` に切替。確定後 `bulkMove=false` に戻す。
- D&D 一括: `dnd.dragging` が選択に含まれ `count>1` のとき ghost `count=selection.count`、`onDrop` は `moveRows(selectedItems,…)`。それ以外は単一（既存）。
- 選択クリア: `useEffect` で `[query, scopeFolderId]` 変化時に `selection.clear()`。`handleEscapeStep` の先頭で `selection.count>0` なら `selection.clear()` して return。一括操作後も clear。
- `selectedItems` = `results.filter(r => selection.selectedIds.has(r.node.id))`（現在表示結果の部分集合。クエリ/スコープ変更で clear するため常に整合）。

### モードヘルパ: `modeMachine.resolveShortcutIntent` に `select-all`

- `ShortcutIntent` に `'select-all'` を追加。`Ctrl/Cmd+A`（Shift なし・Alt なし）で返す。`modeMachine.test.ts` に追加。

## 主要な設計判断

1. **選択はモードにしない**: 選択はフォーカス（selectedIndex）やモード（LIST 等）と直交する状態。`useMode` に SELECT モードを足すと既存のキー意味論と衝突するため、独立フック（`useSelection`）で持つ。ヘッダー差し替え・チェックボックスは選択の非空/内容から純粋に導出する。
2. **一括アンドゥ = undo 1件で全件ループ**: `UndoManager` は1件保持のまま。一括版は undo クロージャ内で全件を戻す。これで「20件移動が1回で戻る」を満たす（AC-4）。
3. **選択は現在の表示結果の部分集合に限定**（クエリ/スコープ変更で clear）: 索引から消えた選択 ID の undo 用データ欠落・件数不整合・幽霊選択を構造的に避ける。実装が単純で堅牢。
4. **Ctrl/Cmd+A は検索ボックスでは奪わない**: テキスト全選択を壊さないため、右ペインフォーカス時のみ全件選択に割り当てる。
5. **一括操作の入口キーは既存を流用**: 選択中の `Delete` は一括削除、`Ctrl+M` は一括移動へ（Popup 側で「選択が非空なら一括」と分岐）。新規キー割り当ては増やさない（衝突回避）。
6. **チェックボックスのホバー表示はオーバーレイ + pointer-events 制御**: ファビコン↔チェックボックスの切替でレイアウトが動かないよう同寸オーバーレイにし、非ホバー時は `pointer-events-none` で誤クリックを防ぐ。

## テスト方針

- `selectionModel.test.ts`: `toggle`（追加/解除・anchor 更新）、`rangeTo`（anchor..target union・逆順・anchor 無し→単一）、`selectAll`、`clear`、`isSelected`。
- `useRowActions`（React 層）自体は直接テストしない（既存方針どおり）。ただし `moveRows`/`deleteRows` の
  中核ロジック（対象フィルタ・1件ごとの部分失敗耐性・undo 全戻し）は `bulkActionsCore.ts`（React/chrome
  非依存・DI）へ切り出し、`bulkActionsCore.test.ts` でモック依存に対して直接検証する（実装検証で
  「forward側は部分失敗に強いが undo側が単一tryで包まれ部分失敗に弱い」不備が指摘され、テストで再発を
  防止する必要があったため。AC-5 の「moveRows・deleteRowsの骨格にユニットテストがある」はこれで満たす）。
- `modeMachine.test.ts`: `resolveShortcutIntent` の `select-all` を追加。
- 品質ゲート: `pnpm test` / `pnpm lint` / `pnpm type-check`（前景で実 exit code 確認）。
