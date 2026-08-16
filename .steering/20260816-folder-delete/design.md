# 設計書 — folder-delete

## アーキテクチャ概要

既存の3層（純粋モデル → React フック → UI）と、`Popup.tsx` が全キー操作を捌く単一 document リスナー方式をそのまま踏襲する。新しい状態管理機構・新しいモードは増やさない。

```
BookmarkService (データ層)        ── removeTree / getSubTree を追加（chrome.bookmarks ラッパ）
TrashStore (データ層・既存)        ── kind:'folder' の push/restore はそのまま使う
        │
folderDeleteModel.ts (純粋)       ── 部分木 → 件数 / ID 一覧 / TrashInput への写像、削除後スコープの解決
        │
useFolderActions.ts (React 層)    ── 削除の手順（退避 → 削除 → 索引 → アンドゥ）を集約
        │
Popup.tsx (結線)                  ── PANEL モードでメニュー/確認ダイアログを出し、スコープと左ペインを追従
        │
FolderContextMenu / ConfirmDialog / FolderTree(Item) (表示)
```

**中心となる設計判断**: 右クリックメニューと確認ダイアログを**既存の `PANEL` モードに載せる**（新しいモードを足さない）。`modeMachine` の `PANEL` は既に
(1) `isSearchFirstExempt` により**全ショートカットを抑止**し、
(2) `resolveKeyIntent('PANEL')` が `↑↓`=候補移動 / `Enter`=決定 / `Escape`=閉じる を返す。
メニューとダイアログが必要とするキー意味論はこれと完全に一致するため、`Mode` を増やすと同じ意味論の重複定義になる。`MovePanel`（U12/U13）・`AddCurrentPanel`（U14）が既に「PANEL + フラグ」で共存しており、本単位も同じ規律に従う。

**そのうえでの改善**: 既存の共存フラグは `bulkMovePanel` / `addCurrentPanelOpen` という**独立した真偽値**で、排他条件が `!bulkMovePanel && !addCurrentPanelOpen` のように増えていく形になっている。本単位で真偽値をさらに2つ足すと条件が組み合わせ爆発するため、**新規分は1つの判別可能ユニオン `folderAction` にまとめ**、既存条件へ加える項も1つ（`folderAction === null`）で済むようにする。既存フラグの統合リファクタは本単位のスコープ外（U12〜U14 の結線に触れる退行リスクを避ける）とし、design 上の申し送りとして残す。

## コンポーネント設計

### 1. `packages/storage/lib/impl/bookmarkService.ts`（拡張）

```ts
/** 部分木（自身 + 子孫）を取得する。フォルダ削除前の退避データ作成に使う。 */
async getSubTree(id: string): Promise<BookmarkNode>

/**
 * フォルダを配下ごと削除する。`remove` は**空でないフォルダに使えない**（chrome が拒否する）ため、
 * フォルダ削除は必ず本メソッドを使う。ブックマーク1件の削除は従来どおり `remove`。
 */
async removeTree(id: string): Promise<void>
```

**実装の要点**:
- `getSubTree` は `chrome.bookmarks.getSubTree(id)` が配列を返すため先頭を取り、既存 `toDomain` で写像する（`children` 再帰は `toDomain` が担当済み）。対象が無い場合は例外を投げる（`getFolderPath` 等と同じく防御的に倒す）。
- 既存メソッドと同じ「薄いラッパ・ドメイン型へ写像するだけ」の粒度を守る。判断ロジックは持たせない。

### 2. `pages/popup/src/components/folderDeleteModel.ts`（新規・純粋）

既存の pure module（`folderTreeModel.ts` / `selectionModel.ts`）に倣い、宣言は非 export・ファイル末尾で export をまとめる。

```ts
/** 配下の内訳（確認ダイアログの文言用）。フォルダ自身は数えない。 */
interface FolderContents { bookmarks: number; folders: number }
const countContents = (node: BookmarkNode): FolderContents

/** 配下ブックマーク（url を持つノード）の ID 一覧（検索索引から落とす対象）。 */
const collectBookmarkIds = (node: BookmarkNode): string[]

/** 配下ブックマークの URL 一覧（別名レコードの除去対象。重複は除く）。 */
const collectBookmarkUrls = (node: BookmarkNode): string[]

/**
 * 部分木を TrashInput（kind:'folder' + children 再帰）へ写像する。
 * `folderPath` は**削除するフォルダ自身の親までのパス**（復元先）。
 * 別名は `aliasesOf(url)` で解決して各ブックマークに埋める（復元時に別名まで戻すため）。
 */
const toTrashInput = (
  node: BookmarkNode,
  folderPath: string[],
  aliasesOf: (url: string) => string[],
): TrashInput

/**
 * 削除後のスコープを解決する。削除対象が現在のスコープ**またはその祖先**なら
 * 削除対象の親（`parentId`・最上位なら null＝すべて）へ移す。無関係なら現在のスコープを返す。
 */
const resolveScopeAfterDelete = (args: {
  scopeFolderId: string | null;
  deletedId: string;
  deletedParentId: string | null;
  scopeAncestorIds: readonly string[];
}): string | null
```

**実装の要点**:
- `resolveScopeAfterDelete` に木そのものを渡さず `scopeAncestorIds`（呼び出し側が既存の `collectAncestorIds(folders, scopeFolderId)` で得る）を渡す。木の走査を再実装せず、判定の純粋性だけを本モジュールに閉じる。
- `toTrashInput` の `aliasesOf` は同期関数として受ける（非同期の解決は呼び出し側で先に済ませる）。純粋関数を `await` 混じりにしないため。
- フォルダ配下のフォルダも `kind: 'folder'`・`aliases: []` で写像する（`TrashItem` の契約どおり）。

### 3. `pages/popup/src/hooks/useFolderActions.ts`（新規）

`useRowActions` と同じシグネチャ規約（`refresh` と `register` を注入・`error`/`clearError` を返す）にする。

```ts
export interface UseFolderActionsApi {
  /** フォルダを配下ごと削除し、5秒の即時アンドゥを登録する。戻り値は成功したか。 */
  deleteFolder: (args: { id: string; title: string; folderPath: string[] }) => Promise<boolean>;
  error: string | null;
  clearError: () => void;
}

export const useFolderActions = (
  refresh: () => void,
  register: (label: string, undo: () => Promise<void>) => void,
  reloadIndex: () => Promise<void>,
  reloadFolders: () => void,
): UseFolderActionsApi
```

**手順（`deleteFolder`）**:

```
1. subtree = await bookmarkService.getSubTree(id)               ← 削除前に退避データを作る
   aliasMap = await aliasStore.getAll()                          ← Map<urlHash, AliasRecord>
   trashInput = toTrashInput(subtree, folderPath, url => aliasMap.get(normalizer.hashUrl(url))?.aliases ?? [])
   ids  = collectBookmarkIds(subtree)
   urls = collectBookmarkUrls(subtree)
2. await bookmarkService.removeTree(id)                          ← 失敗 → エラートースト・return false（索引は触らない）
3. for (url of urls) await aliasStore.remove(url)                ← 失敗はログのみ（削除自体は成功扱い）
4. trashId = await trashStore.push(trashInput)                   ← 失敗はログのみ（trashId = null）
5. ids.forEach(searchEngine.removeNode); refresh(); reloadFolders()
6. register('「<title>」を削除しました', undo)
```

**アンドゥ（`undo`）**:
```
- trashId === null（ゴミ箱への退避に失敗）→ 復元手段が無いためエラートーストを出して終了する
- await trashStore.restore(trashId)   ← フォルダ構造 + 別名まで再帰復元（TrashStore 実装済み）
- await reloadIndex()                 ← 復元後のノードは**新しい ID** のため部分更新では整合しない。索引を再構築する
- reloadFolders()                     ← 左ペインを再取得
- 失敗時はエラートースト（ゴミ箱には項目が残るため、オプションページから復元できる）
```

**実装の要点**:
- 別名の除去（手順3）は URL ごとに逐次 `await` する。`AliasStore` は内部の `writeQueue` で直列化しており、並列に投げても結局直列に処理されるため、逐次のほうが失敗の切り分けが素直。
- 手順2で失敗したら**それ以降を一切行わない**（実データが消えていないのに索引から消す＝表示と実データの乖離、を作らない。`development-guidelines` のエラーハンドリング方針）。
- 手順4のゴミ箱退避が失敗した場合でも削除自体は成功として扱う（`deleteRow` と同じ）。ただしアンドゥは `trashStore.restore` に依存するため、`trashId === null` のときはアンドゥで復元できない旨をエラートーストで伝える。**黙って何も起きないのが最悪**なので明示する。
- `reloadIndex` は `useSearch` に新設する（下記）。フックが `searchEngine.loadIndex` を直接呼ぶと `isIndexReady` 等の state と二重管理になるため、索引の所有者である `useSearch` に置く。

### 4. `pages/popup/src/hooks/useSearch.ts`（拡張）

```ts
/**
 * 索引を作り直す（フォルダ削除のアンドゥ等、ID が新規採番される復元の後に使う）。
 * 部分更新（addNode）では復元後の新しい ID を追随できないため、全体を組み直す。
 */
reloadIndex: () => Promise<void>
```
`loadIndex` を再実行して `indexVersion` を進めるだけの薄い追加。失敗時はログを残し、`results` は直前の索引のまま維持する。

### 5. `pages/popup/src/components/FolderContextMenu.tsx`（新規）

```
              ┌──────────────────┐
右クリック位置 →│ 🗑 削除           │   ← 項目1つ（将来の追加を想定した配列駆動）
              └──────────────────┘
```

**props**: `x`, `y`, `items: { key, label, danger?, disabled?, disabledHint? }[]`, `selectedIndex`, `onSelect(key)`, `onClose`, `actionsRef`

**実装の要点**:
- `MovePanel` と同じ「背景オーバーレイ + 命令ハンドル（`actionsRef`）」構成にする。キー処理は Popup の document リスナーが `PANEL` インテントとして解決し、`selectPrev`/`selectNext`/`confirm`/`close` を呼ぶ。
- 位置は `x`/`y` を起点に、`760×560` の外へ出ないようクランプする（純粋計算のため `folderDeleteModel` ではなくコンポーネント内のローカル関数に置く。他から使わないため）。
- 無効項目（最上位フォルダの削除）は `↑↓` でフォーカスはできるが `Enter` で発火しない。理由を `title` で示す。
- 背景オーバーレイのクリックで閉じる（`MovePanel` と同じ）。

### 6. `pages/popup/src/components/ConfirmDialog.tsx`（新規）

```
┌───────────────────────────────────────┐
│ 「chrome」を削除します                  │
│ 中のブックマーク 12 件・フォルダ 3 件も  │
│ 一緒に削除されます。                    │
│                                       │
│              [ キャンセル ] [ 削除する ] │
└───────────────────────────────────────┘
```

**props**: `title`, `message`, `confirmLabel`, `cancelLabel`, `danger?`, `onConfirm`, `onCancel`, `actionsRef`

**実装の要点**:
- **既定フォーカスは [キャンセル]**（`focusedIndex` の初期値をキャンセル側にする）。破壊的操作を `Enter` の連打で誤発火させないため。
- `↑↓` と `←→` の両方でボタン間を移動できるようにする（横並びのボタン列に対して `↑↓` しか効かないのは不自然だが、`PANEL` の `resolveKeyIntent` は `↑↓` を候補移動として返すため、`←→` は本コンポーネント側で `keydown` を拾わず **Popup 側で `PANEL` かつダイアログ表示中のときに `panel:candidate-*` と同じ扱いへ倒す**）。
- 汎用の確認ダイアログとして作る（フォルダ削除固有の文言は呼び出し側が渡す）。将来の破壊的操作でも使い回せる。

### 7. `FolderTreeItem.tsx` / `FolderTree.tsx`（拡張）

- `FolderTreeItem`: フォルダ行のラッパ `div`（`data-folder-id` を持つ既存要素）に `onContextMenu` を付け、`e.preventDefault()` の上で親へ `(folderId, clientX, clientY)` を通知する。`row.kind === 'folder'` の分岐内にのみ置くため、「すべて」/「さらに N 件…」行では自動的に無効になる（AC-1）。
- `FolderTree`:
  - props に `onFolderContextMenu?: (args: { folderId: string; title: string; depth: number; x: number; y: number }) => void` を追加し、行から親へ中継する。`depth` は最上位判定（`depth === 0`）に使う。
  - `actionsRef`（`FolderTreeActions`）に **`reload: () => void`** を追加する。起動時の取得処理を `loadTree` として切り出し、`useEffect` と `reload` の両方から呼ぶ。
  - 再読み込み時も `onFoldersLoaded` を呼び、Popup 側の `folders`（チップ/パス解決に使う）を最新化する。

### 8. `Popup.tsx`（結線）

**新規 state（判別可能ユニオン1つ）**:
```ts
type FolderAction =
  | { kind: 'menu'; folderId: string; title: string; deletable: boolean; x: number; y: number }
  | { kind: 'confirm'; folderId: string; title: string; folderPath: string[]; contents: FolderContents };

const [folderAction, setFolderAction] = useState<FolderAction | null>(null);
```

| 箇所 | 変更 |
|---|---|
| 右クリック受信 | `openFolderMenu(...)`: `exitToList(); enterPanel();`（`ENTER_PANEL` は LIST からのみ有効なため既存2箇所と同じ経由）して `folderAction = {kind:'menu'}` |
| メニューの「削除」 | 部分木を取得して `countContents` → 空なら即 `deleteFolder`、中身ありなら `folderAction = {kind:'confirm'}` へ差し替え（PANEL のまま） |
| 確認の [削除する] | `deleteFolder` を実行 → スコープ追従 → メニュー/ダイアログを閉じ、**左ペインへフォーカスを戻す** |
| 閉じる共通 | `closeFolderAction()`: `setFolderAction(null)` + `exitToList()` + `enterFolderTree()`（操作の起点である左ペインへ戻す。既存パネルの `focusSearch()` とは意図的に変える） |
| 既存パネルの排他条件 | `!addCurrentPanelOpen` 等に `folderAction === null` を1項だけ追加 |
| PANEL のキー処理 | `folderAction` があるときは、その命令ハンドル（メニュー or ダイアログ）へ `panel:*` インテントを流す。`←→` はダイアログ表示中のみ候補移動として扱う |
| スコープ追従 | `resolveScopeAfterDelete` の結果を `setScopeFolderId` に反映（AC-8） |
| トースト | `folderActions.error` を既存の `rowActions.error` / `addCurrent.error` と同じ分岐へ追加 |

### 9. i18n（`packages/i18n/locales/{ja,en}/messages.json`）

| キー | ja | en |
|---|---|---|
| `popupFolderMenuDelete` | フォルダを削除 | Delete folder |
| `popupFolderMenuDeleteDisabled` | 最上位のフォルダは削除できません | Top-level folders can't be deleted |
| `popupFolderDeleteConfirmTitle` | 「$1」を削除します | Delete "$1" |
| `popupFolderDeleteConfirmBody` | 中のブックマーク $1 件・フォルダ $2 件も一緒に削除されます。 | Its $1 bookmarks and $2 folders will be deleted too. |
| `popupFolderDeleteConfirmAction` | 削除する | Delete |
| `popupUndoFolderDeleted` | 「$1」を削除しました | Deleted "$1" |
| `popupErrorFolderDeleteFailed` | フォルダの削除に失敗しました | Failed to delete the folder |
| `popupErrorFolderUndoUnavailable` | ゴミ箱への退避に失敗したため元に戻せません | Can't undo: the folder wasn't saved to Trash |

`commonCancel`（キャンセル）は既存キーを流用する。

## データフロー

### UC-A: 中身のあるフォルダを削除して元に戻す
```
1. 左ペインの「chrome」を右クリック → PANEL へ入り FolderContextMenu 表示
2. 「フォルダを削除」を Enter/クリック
3. getSubTree → countContents = {bookmarks:12, folders:3} → 空でないので ConfirmDialog へ差し替え
4. [削除する] → useFolderActions.deleteFolder
   4-1. TrashInput 組み立て（別名を解決して埋める）
   4-2. removeTree → aliasStore.remove ×12 → trashStore.push（1項目）
   4-3. searchEngine.removeNode ×12 → refresh() → FolderTree.reload()
   4-4. スコープが chrome / その子孫なら親「開発」へ移動
   4-5. 5秒トースト「「chrome」を削除しました [元に戻す]」
5. [元に戻す] → trashStore.restore → reloadIndex() → FolderTree.reload()
   → フォルダ構造・12件のブックマーク・別名が元の階層へ復帰（ID は新規採番）
```

### UC-B: 空フォルダを削除する
```
1. 右クリック → 「フォルダを削除」
2. countContents = {bookmarks:0, folders:0} → 確認ダイアログを出さずに即 deleteFolder
3. 以降は UC-A の 4-2 以降と同じ（アンドゥも同様に効く）
```

## エラーハンドリング戦略

新しいエラークラスは作らない（既存方針どおり「ログ + トースト」で扱う）。

| 失敗箇所 | 扱い |
|---|---|
| `getSubTree` | エラートースト。削除は行わない |
| `removeTree` | エラートースト。**索引・左ペインには一切触れない**（表示と実データの乖離を作らない） |
| `aliasStore.remove` | ログのみ。削除は成功扱いで続行（別名レコードの孤児は復元時の `upsert` で整合する） |
| `trashStore.push` | ログのみ。削除は成功扱い。ただしアンドゥ実行時に「復元できない」旨のトーストを出す |
| `trashStore.restore`（アンドゥ） | エラートースト。項目はゴミ箱に残るためオプションページから復元できる |
| `reloadIndex` | ログのみ。`results` は直前の索引のまま（次回起動で再構築される） |

## テスト戦略

### ユニットテスト（新規・追加）

`pages/popup/src/components/folderDeleteModel.test.ts`（新規）:
- `countContents`: 空 / 直下のみ / ネストした孫まで / フォルダのみ（ブックマーク0件）
- `collectBookmarkIds` / `collectBookmarkUrls`: 深いネスト、重複 URL の排除
- `toTrashInput`: `kind`・`folderPath`・`children` の再帰構造、別名の埋め込み、フォルダの `aliases: []`
- `resolveScopeAfterDelete`: 削除対象＝スコープ / 削除対象がスコープの祖先 / 無関係 / 最上位（親 null →「すべて」）

`packages/storage/lib/impl/bookmarkService.test.ts`（追加）:
- `removeTree` が `chrome.bookmarks.removeTree(id)` を呼ぶ
- `getSubTree` が `getSubTree(id)` の先頭要素をドメイン型（`children` 再帰）へ写像する / 空配列なら例外

### 手動確認（受け入れ時）

- 右クリックでブラウザ既定メニューが出ないこと / 「すべて」行で開かないこと
- 最上位フォルダで削除が無効表示になること
- 中身ありの確認 → キャンセルで何も消えないこと
- 削除 → アンドゥでフォルダ構造と別名が戻ること
- ゴミ箱タブに 📁 + 件数で1項目として並び、そこからも復元できること

## 依存ライブラリ

追加なし。

## ディレクトリ構造

```
packages/storage/lib/impl/
├── bookmarkService.ts               (拡張: removeTree / getSubTree)
└── bookmarkService.test.ts          (追加テスト)

pages/popup/src/
├── components/
│   ├── folderDeleteModel.ts         (新規・純粋)
│   ├── folderDeleteModel.test.ts    (新規)
│   ├── FolderContextMenu.tsx        (新規)
│   ├── ConfirmDialog.tsx            (新規)
│   ├── FolderTree.tsx               (拡張: onFolderContextMenu / actions.reload)
│   └── FolderTreeItem.tsx           (拡張: onContextMenu)
├── hooks/
│   ├── useFolderActions.ts          (新規)
│   └── useSearch.ts                 (拡張: reloadIndex)
└── Popup.tsx                        (結線: folderAction ユニオン・スコープ追従・キー配線)

packages/i18n/locales/{ja,en}/messages.json  (8キー追加)
docs/functional-design.md                     (フォルダ削除の操作・UC を追記)
docs/product-requirements.md                  (機能5 にフォルダ削除の受け入れ条件を追記)
```

## 実装の順序

1. データ層（`BookmarkService.removeTree` / `getSubTree`）+ テスト
2. 純粋モデル（`folderDeleteModel`）+ テスト
3. `useSearch.reloadIndex` → `useFolderActions`
4. i18n キー追加
5. UI（`FolderContextMenu` → `ConfirmDialog` → `FolderTreeItem` → `FolderTree`）
6. `Popup.tsx` 結線
7. 品質ゲート（test / lint / type-check）
8. 永続ドキュメント更新

## セキュリティ考慮事項

- 追加権限は不要（`bookmarks` 権限の範囲内。`chrome.bookmarks.removeTree` は既存権限で呼べる）。
- 外部通信は増えない（Findmark の「外部通信ゼロ」方針を維持）。
- 破壊的操作のため、**削除前の退避（ゴミ箱）を必ず削除実行の前に組み立てる**。削除後にツリーを読もうとしても既に存在しない。

## パフォーマンス考慮事項

- 別名レコードの除去は配下ブックマーク数に比例した書き込みになる。`AliasStore` の `writeQueue` で直列化されるため、巨大フォルダ（数百件）では時間がかかる。ただしブックマークの削除自体は `removeTree` 1回で完了しており、UI の反映（索引更新・左ペイン再読み込み）は別名除去の完了を待たない設計にはしない（待たないと「消えたのに別名が残っている」中間状態が見えるため）。実測で問題が出たら別単位で並列化を検討する。
- アンドゥ時の `reloadIndex` は全ブックマークの索引再構築（起動時と同じコスト・数百 ms 想定）。フォルダ削除のアンドゥという低頻度操作に限られるため許容する。

## 将来の拡張性

- `FolderContextMenu` は項目配列駆動のため、フォルダのリネーム・新規作成・「このフォルダをスコープにする」等を項目追加だけで足せる。
- `ConfirmDialog` は汎用（文言は呼び出し側が渡す）のため、他の破壊的操作（ゴミ箱を空にする等）にも再利用できる。
- **申し送り**: `PANEL` モードの共存フラグが `bulkMovePanel` / `addCurrentPanelOpen` / `folderAction` の3系統になった。次に PANEL 用途を足すときは、これらを1つの `panelKind` ユニオンへ統合するリファクタを先に行うべき（本単位では既存2つに手を入れる退行リスクを避けて見送った）。
