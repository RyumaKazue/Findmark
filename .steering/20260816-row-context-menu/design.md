# 設計書 — row-context-menu

## アーキテクチャ概要

新しい仕組みは増やさない。`folder-delete` で作った「PANEL モードに載せた右クリックメニュー + 命令ハンドル（`actionsRef`）」をそのまま行へ広げ、**メニューコンポーネントを汎用化**する。削除・編集・移動の実処理は既存のハンドラ（`useRowActions` / `useMode`）を呼ぶだけで、新しいオーケストレーションは作らない。

```
ContextMenu.tsx (旧 FolderContextMenu)   ── 項目配列・座標・命令ハンドル。フォルダ/行の両方から使う
        │
rowMenuModel.ts (純粋・新規)             ── 「いま行に対して何ができるか」を項目配列へ写像する
        │
Popup.tsx (結線)                          ── contextAction ユニオンに 'row-menu' を追加し、
        │                                    実行は既存ハンドラ（enterInlineEditAt 等）へ委譲
ResultRow / ResultList                    ── 行の onContextMenu を中継。✎/🗑 を撤去（別名エリアは存置）
```

**中心となる設計判断**: メニュー項目の**組み立てを純粋関数に切り出す**（`rowMenuModel.ts`）。項目の並び・区切り・「選択モード中は出さない」「結果が空なら出さない」といった条件は、放っておくと `Popup.tsx` の JSX 内の三項演算子に散る。`folder-delete` ではメニュー項目が1つだったため直書きで足りたが、4項目 + 区切り + 抑止条件となると分岐がテスト不能な場所に溜まる。純粋関数にしてユニットテストで固定する（`modeMachine.isShortcutEnabled` と同じ考え方）。

## コンポーネント設計

### 1. `FolderContextMenu.tsx` → `ContextMenu.tsx`（改名・汎用化）

**変更内容**:
- ファイル名・エクスポート名を改名する: `FolderContextMenu` → `ContextMenu`、`FolderContextMenuActions` → `ContextMenuActions`、`FolderMenuItem` → `MenuItem`。
- `MenuItem` に `separatorBefore?: boolean` を追加し、その項目の**上に区切り線**を描く（破壊的な「削除」を他と視覚的に離す）。
- doc コメントの「フォルダ行の」という限定を外す。

**変更しないもの**: 座標クランプ・オーバーレイ・未フォーカス初期値（`NO_FOCUS`）・キーボード挙動・右クリックで閉じる挙動。`folder-delete` の2ラウンドの修正で固まった部分をそのまま活かす。

区切り線は項目の上に `<div role="separator">` を挟む形にする（`MENU_WIDTH` の座標クランプ計算には項目高さしか使っていないため、`clampPosition` に区切り分の高さを足す）。

### 2. `rowMenuModel.ts`（新規・純粋）

**責務**: 「いまこの行に対してメニューを出すか / 出すなら何を並べるか」を決める。

```ts
/** 行メニューの項目キー（実行の分岐に使う）。 */
type RowMenuKey = 'edit' | 'alias-edit' | 'move' | 'delete';

interface RowMenuContext {
  /** 選択モード中か（`selectionModel.active`）。true ならメニューを出さない。 */
  selectionMode: boolean;
  /** 対象行が存在するか（結果0件・範囲外の防御）。 */
  hasTarget: boolean;
}

/** メニューを開いてよいか（AC-8 / 防御）。 */
const canOpenRowMenu = (ctx: RowMenuContext): boolean

/**
 * 項目の並びを返す（ラベルは呼び出し側が翻訳して差し込むため、ここではキーと表示属性のみ）。
 * 「削除」の直前に区切りを入れる（破壊的操作を他と視覚的に離す）。
 */
const buildRowMenuItems = (): { key: RowMenuKey; danger?: boolean; separatorBefore?: boolean }[]
```

**実装の要点**:
- ラベル（i18n）は返さない。純粋関数を `useI18n` に依存させないため、`Popup` 側で `key → t(...)` を引く。
- 現時点で `buildRowMenuItems` は引数を取らない固定配列だが、関数として置く。将来「URL が無い行では編集を無効」等の条件が入る場所を1箇所に決めておくため（項目の並びが JSX に散ることを防ぐのが本モジュールの目的）。

### 3. `ResultRow.tsx`（改訂）

| 変更 | 内容 |
|---|---|
| props 追加 | `onContextMenu?: (position: { x: number; y: number }) => void` |
| ✎／🗑 アイコン | **削除**（`data-row-action` のクリック分岐・`onDelete` prop ごと撤去） |
| 別名エリア | **現状維持**（決定事項5）。`data-alias-area` のクリック分岐・`onEnterAliasEdit` prop をそのまま残す |
| 「＋別名」チップ | **現状維持**（別名を付ける入口を消さない） |
| `handleMouseDown` | 除外セレクタから `[data-row-action]` のみ外す（`[data-alias-area]` は残す＝チップ上の微小なブレでドラッグを誤発火させない） |
| ダブルクリック | 現状維持（`selectionMode` 中は無効も現状維持） |

**注意**: `onDelete` は `ResultList` 経由で `Popup` から渡っているが、行からは使わなくなるため props を落とす。**`Popup` 側のハンドラ `handleDeleteAt` はメニューとショートカットが使い続ける**ため残す。`onEnterAliasEdit` は別名エリアが存置されるため props も残す。

### 4. `ResultList.tsx`（改訂）

`onRowContextMenu?: (index: number, position: {x,y}) => void` を追加して各行へ中継する。`onDeleteRow` は `ResultRow` へ渡さなくなるため `ResultList` の API からも削除する。`onEnterAliasEdit` は別名エリアの存置に伴い**そのまま残す**。

### 5. `Popup.tsx`（結線）

**state の一般化**: `folderAction` を `contextAction` へ改名し、行メニューを variant として足す。

```ts
type ContextAction =
  | { kind: 'folder-menu'; folderId: string; title: string; deletable: boolean; x: number; y: number }
  | { kind: 'folder-confirm'; folderId: string; title: string; folderPath: string[]; contents: FolderContents | null }
  | { kind: 'row-menu'; index: number; x: number; y: number };
```

`folder-delete` の design.md で「PANEL 用途が増えたら `panelKind` ユニオンへ統合すべき」と申し送ったが、本単位は**既存ユニオンに variant を1つ足すだけ**で済むため、統合リファクタ（`bulkMovePanel` / `addCurrentPanelOpen` を含む）は引き続き別単位とする。排他条件に加える項は `contextAction === null` のままで増えない。

| 箇所 | 変更 |
|---|---|
| 行の右クリック受信 | `canOpenRowMenu` が false なら何もしない。true なら `exitToList(); enterPanel();` → `contextAction = {kind:'row-menu', index, x, y}` |
| 行メニューの実行 | `key` で分岐し、既存ハンドラへ委譲（下表） |
| PANEL のキー処理 | `contextAction.kind` に応じて命令ハンドルを選ぶ（`row-menu` は `contextMenuActionsRef`、`folder-menu` も同じ ref を使い回す＝同時に開かないため1つで足りる） |
| 閉じる | `closeFolderAction` を `closeContextAction` に改名。行メニューから閉じた場合は**右ペインへフォーカスを戻す**（フォルダは左ペインへ戻す。操作の起点に戻すという既存の規律を維持） |

**項目の実行（すべて既存ハンドラ）**:

```
'edit'       → setContextAction(null); enterInlineEditAt(index)     // 内部で selectedIndex を合わせる
'alias-edit' → setContextAction(null); enterAliasEditAt(index)      // 同上
'move'       → setContextAction(null); setSelectedIndex(index); exitToList(); enterPanel()
'delete'     → setContextAction(null); handleDeleteAt(index)
```

- `'move'` だけ `MovePanel` の対象が `results[selectedIndex]` で決まるため `setSelectedIndex` を明示する。他は各ハンドラが内部で `selectedIndex` を合わせる。
- いずれも PANEL（メニュー）から抜けるため `exitToList()` を経由する（`enterInlineEditAt` / `enterAliasEditAt` は内部で実施済み）。

### 6. i18n

既存キーを流用し、**メニュー用に3キーだけ追加**する（既存の `popupRowEdit`＝「編集（F2）」等はツールチップ用にショートカット表記を含んでおり、メニュー項目としては冗長なため）。

| キー | ja | en | 備考 |
|---|---|---|---|
| `popupRowMenuEdit` | 編集 | Edit | 新規 |
| `popupRowMenuAliasEdit` | 別名を編集 | Edit aliases | 新規 |
| `popupRowMenuMove` | フォルダへ移動… | Move to folder… | 新規 |
| （削除） | — | — | 既存 `commonDelete`（削除 / Delete）を流用 |

`popupRowEdit`（編集（F2））・`popupRowDelete`（削除（Delete））は ✎／🗑 のツールチップ専用で参照元が無くなるため**削除する**（未使用キーを残さない）。
`popupRowAliasEdit`（クリックで別名を編集）・`popupRowAddAlias`（＋別名）は**別名エリアの存置に伴い残す**。

## データフロー

### UC-A: 行を右クリックして別名を編集する
```
1. 行を右クリック → ResultRow が preventDefault + 座標を通知（行の状態は変えない）
2. Popup: canOpenRowMenu（選択モードでない・対象行あり）→ exitToList → enterPanel
   → contextAction = {kind:'row-menu', index, x, y}
3. ContextMenu 表示（未フォーカス。↑↓ or ホバーで項目を選ぶ）
4. 「別名を編集」→ contextAction=null → enterAliasEditAt(index)
   → selectedIndex=index、LIST 経由で ALIAS_EDIT へ
5. 以降は U9 の別名編集フローそのまま（Enter 確定・Escape 終了）
```

### UC-B: 行を右クリックして削除する
```
1〜3 は UC-A と同じ
4. 「削除」→ contextAction=null → handleDeleteAt(index)
   → useRowActions.deleteRow（remove → alias 除去 → ゴミ箱 push → 索引更新 → 5秒アンドゥ登録）
5. トースト「「〜」を削除しました [元に戻す]」
```

## エラーハンドリング戦略

新しいエラー経路は無い。削除・移動・編集の失敗時のトーストは `useRowActions` の既存実装をそのまま使う。

メニューを開いてから実行するまでの間に結果が変わる（検索の debounce・別ウィンドウでの変更）可能性があるため、**実行時に `results[index]` が存在しない場合は何もしない**（各ハンドラは既に `if (!item) return` の防御を持つ）。

## テスト戦略

### ユニットテスト（新規）

`pages/popup/src/components/rowMenuModel.test.ts`:
- `canOpenRowMenu`: 通常モード + 対象あり = true / 選択モード中 = false / 対象なし = false
- `buildRowMenuItems`: キーの順序が `edit → alias-edit → move → delete`、`delete` が `danger` かつ `separatorBefore`、他は非 danger

### 既存テストへの影響

`ResultRow` / `ResultList` にユニットテストは無い（既存方針どおり UI は手動確認）。`modeMachine` / `selectionModel` は変更しないため既存テストはそのまま通る。

### 手動確認（受け入れ時）

- 行のどこを右クリックしてもメニューが開く / ブラウザ既定メニューが出ない
- 4項目すべてが正しい行に対して効く（右クリックした行 ≠ フォーカス行のときが重要）
- ホバーしても ✎／🗑 が出ない（その領域を押すと**開く**）／別名チップのクリックでは従来どおり**別名編集に入る**
- 選択モード中は右クリックで何も出ない
- ダブルクリック・各ショートカット・D&D が従来どおり

## 依存ライブラリ

追加なし。

## ディレクトリ構造

```
pages/popup/src/
├── components/
│   ├── ContextMenu.tsx            (改名: FolderContextMenu.tsx / separatorBefore 追加)
│   ├── rowMenuModel.ts            (新規・純粋)
│   ├── rowMenuModel.test.ts       (新規)
│   ├── ResultRow.tsx              (改訂: 右クリック中継 / ✎🗑 撤去)
│   └── ResultList.tsx             (改訂: 右クリック中継 / 不要 props 削除)
└── Popup.tsx                      (改訂: contextAction ユニオン化・行メニューの結線)

packages/i18n/locales/{ja,en}/messages.json  (3キー追加 / 2キー削除)
docs/design/README.md                         (操作一覧・結果行の共通仕様を改訂)
docs/functional-design.md                     (結果行の操作導線を改訂)
```

## 実装の順序

1. `ContextMenu` への改名 + `separatorBefore`（フォルダ側が壊れないことを型で確認）
2. `rowMenuModel` + テスト
3. i18n（追加3 / 削除4）
4. `ResultRow` / `ResultList`（撤去と右クリック中継）
5. `Popup.tsx` 結線（`contextAction` へ一般化）
6. 品質ゲート
7. 永続ドキュメント更新

## セキュリティ考慮事項

権限・データフローの変更なし。削除は既存の2層防御（5秒アンドゥ + 30日ゴミ箱）をそのまま通る。

## パフォーマンス考慮事項

- 行あたりの DOM 要素が**減る**（✎／🗑 とそのラッパの 3 要素）。仮想スクロールの可視行数ぶんだけ軽くなる。
- メニューは開いているときだけマウントされる（1個）。

## 将来の拡張性

- `ContextMenu` が汎用化されるため、右ペインのメタ行・オプションページ等でも同じ見た目のメニューを出せる。
- `rowMenuModel.buildRowMenuItems` に条件（URL 無し行での無効化・「新しいタブで開く」の追加）を足す場所が決まっている。
- **申し送り（`folder-delete` から継続）**: PANEL の用途は `bulkMovePanel` / `addCurrentPanelOpen` / `contextAction`（3 variant）の3系統のまま。次に PANEL 用途を足すときは `panelKind` ユニオンへの統合を先に行う。
