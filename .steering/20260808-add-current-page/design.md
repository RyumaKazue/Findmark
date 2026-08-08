# 設計 — U14 add-current-page

## 方針

- レイヤー依存（UI → サービス → データ）を厳守。chrome API 呼び出しは `BookmarkService`/`AliasStore`（既存 + 1メソッド追加）に閉じる。
- **既存の破壊的操作オーケストレーション（`useRowActions`）を最大限再利用する。** 削除は `deleteRow`、移動は `moveRow`、タイトル変更は `commitEdit` にそのまま委譲し、5秒アンドゥ・索引更新のロジックを重複させない。これらは `SearchResultItem` 形の引数を要求するため、`useAddCurrent` は現在の登録状態から**疑似 `SearchResultItem`** を都度組み立てて渡す（`node.id/parentId/title/url` と `folderPath`/`aliases` のみが実際に参照される）。
- **新規モードを追加しない。** U13 が確立した「共有 `PANEL` モード + 用途を示す boolean フラグ」パターン（`bulkMovePanel`）を踏襲し、`addCurrentPanel` フラグを追加する。これにより `Mode`/`modeReducer`/`resolveKeyIntent`/`isSearchFirstExempt` は無改修で済み、U12 で確立した「document レベルの命令ハンドルで Escape を処理する」堅牢なパターンをそのまま利用できる（背景の結果行が Enter/Escape を奪う既知の不具合クラスの再発を防ぐ）。
- 別名編集は既存 `AliasEditor` をそのまま埋め込み、フォルダ選択は `movePanelModel`（U12）の純粋関数を再利用する。デザインモックが存在しない領域のため、既存トークン（`MovePanel`/`AliasEditor` で確立済みの配色・角丸・影）に忠実な新規レイアウトとする。

## モジュール構成

### データ層: `BookmarkService.findByUrl`（`packages/storage/lib/impl/bookmarkService.ts`）

```ts
/** 指定 URL に一致する既存ブックマークを検索する(現在ページ登録時の重複判定・U14)。 */
async findByUrl(url: string): Promise<BookmarkNode | null> {
  const results = await this.bookmarks.search({ url });
  const first = results.find(r => r.url !== undefined); // フォルダは対象外
  return first ? this.toDomain(first) : null;
}
```

### フック: `useAddCurrent.ts`（`pages/popup/src/hooks/`）

```ts
interface AddCurrentEntry {
  id: string;
  title: string;
  url: string;
  parentId: string | undefined;
  folderPath: string[];
  aliases: string[];
  alreadyRegistered: boolean;
}

interface UseAddCurrentApi {
  entry: AddCurrentEntry | null;
  error: string | null;
  clearError: () => void;
  open: () => Promise<boolean>;               // 成功時 true（Popup 側が enterPanel する契機）
  updateTitle: (title: string) => Promise<void>;
  updateFolder: (folderId: string, folderPath: string[]) => Promise<void>;
  updateAliases: (aliases: string[]) => Promise<void>;
  remove: () => Promise<void>;                 // 完了後 entry を null にする
  reset: () => void;                           // パネルを閉じる際に entry を null にする（Popup が呼ぶ）
}
```

`open()` の手順（UC 相当。functional-design「インタラクティブ操作フロー(現在ページ登録)」）:
1. `bookmarkService.getCurrentTab()` で `{url, title}` を取得。
2. `validateUrl(url)`（`inlineEditModel.ts` を再利用）で拒否判定。不正なら `setError(message)` し `false` を返す。
3. `bookmarkService.findByUrl(url)` で重複確認。
   - **既存あり**: `getFolderPath(existing.id)` と `aliasStore.getByUrl(url)` で `entry` を構成し `alreadyRegistered: true`。
   - **既存なし**: `localStateStore.get()` の `lastUsedFolderId`（無ければ `ensureFolderPath([])` で既定書き込み先）を親に `bookmarkService.create({url, title, parentId})` → `searchEngine.addNode(created, folderPath, [])` → `refresh()`。`folderPath` は `findFolderPath(folders, parentId)`（呼び出し側が渡す現在の `folders`）で求める。`alreadyRegistered: false`。
4. `entry` を set し `true` を返す。

`updateTitle`/`updateFolder`/`updateAliases`/`remove` は `entry` から疑似 `SearchResultItem` を組み立てて `rowActions` の対応メソッドへ委譲する:

```ts
const toItem = (e: AddCurrentEntry): SearchResultItem => ({
  node: { id: e.id, parentId: e.parentId, title: e.title, url: e.url },
  folderPath: e.folderPath,
  aliases: e.aliases,
  matchedAliases: [],
  matchedFields: [],
  score: 0,
});
```

- `updateTitle(title)`: `rowActions.commitEdit(toItem(entry), { type: 'update', title })` → 成功後 `entry.title` をローカルにも反映。
- `updateFolder(folderId, folderPath)`: `rowActions.moveRow(toItem(entry), folderId, folderPath)`（同一フォルダなら no-op のまま）→ `localStateStore.setLastUsedFolder(folderId)` → `entry.parentId/folderPath` を反映。
- `updateAliases(aliases)`: `aliasStore.upsert(entry.url, aliases)` → `searchEngine.updateAliases(entry.url, aliases)` → `refresh()`（Popup の既存 `commitAliases` と同じ2行。別名は URL 紐付けのため `rowActions` を介さず直接呼ぶ）→ `entry.aliases` を反映。
- `remove()`: `rowActions.deleteRow(toItem(entry))`（5秒アンドゥ付き）→ `entry` を `null` に。

依存注入: `useAddCurrent(folders: FolderTreeNode[], refresh: () => void, rowActions: UseRowActionsApi)`。

### UI: `AddCurrentPanel.tsx`（`pages/popup/src/components/`）

- MovePanel と同じ全画面オーバーレイ（`bg-black/20` backdrop + 中央固定カード。`shadow-shell`/`border-line`/`rounded-lg`）。
- 構成（上から）:
  1. ヘッダー行: タイトル「ページを登録」+ `alreadyRegistered` なら「★ 登録済み」バッジ（`bg-accent-bg text-accent-strong` の pill）。
  2. タイトル入力（`<input>`。フォーカスアウトで `onTitleChange` を呼ぶ。design の入力トークン=`border-line`/`focus:border-accent`/`h-[34px]` を流用）。
  3. 保存先フォルダ: 通常はボタン表示（📁 + 圧縮パス。`compressPath`/`formatPath` を再利用）。クリックで**インライン展開**する絞り込みリスト（`movePanelModel.buildMoveCandidates(folders, null)`＋`filterCandidates`＋`clampIndex`。`currentParentId=null` を渡し**どのフォルダも無効化しない**＝現在地を選び直しても no-op になるだけで害がない）。展開中のみ入力へフォーカスし、`↑↓`/`Enter`/`Escape` はこの入力の `onKeyDown` で `stopPropagation()`（`AliasEditor` と同じ自己完結パターン）。Escape はドロップダウンだけを閉じ、パネル全体は閉じない（入れ子の内側から先に閉じる）。
  4. 別名: `<AliasEditor url={entry.url} initialAliases={entry.aliases} matchedAliases={[]} onCommit={onAliasesChange} onClose={onClose}>`。`AliasEditor` 自身の Escape/空入力 Enter は自己完結（`stopPropagation`）で「別名編集を終了する」動作をするため、`onClose` にパネル全体の `onClose` をそのまま渡すと**別名欄からの Escape でパネル全体が閉じる**（実装検証で `noop`案の「別名欄でEscapeが何も起きず抜け出せない」という手詰まりを避けるため、`noop` から変更した）。
  5. フッターボタン: `[削除]`（危険色枠。`onDelete`→`remove()`→`reset()`+パネルを閉じる）/ `[完了]`（accent 塗り。`onClose`）。
- Props: `entry`, `folders`, `onTitleChange`, `onFolderChange`, `onAliasesChange`, `onDelete`, `onClose`, `actionsRef`（`{ close: () => void }` のみを公開。U12/U13 の命令ハンドル方式を踏襲）。

### モードヘルパ: `modeMachine.ts`

- `ShortcutIntent` に `'add-current'` を追加。`resolveShortcutIntent`: `Ctrl(Cmd)+D`（Shift なし）で返す。`SHORTCUTS.addCurrent = 'Ctrl(Cmd)+D'`。
- **`Mode`/`modeReducer`/`resolveKeyIntent`/`isSearchFirstExempt` は変更しない**（`PANEL` を共用するため）。

### 結線: `Popup.tsx`

- `const rowActions = useRowActions(...)`（既存）の後に `const addCurrent = useAddCurrent(folders, refresh, rowActions);` を追加。
- `const [addCurrentPanelOpen, setAddCurrentPanelOpen] = useState(false);`（`bulkMovePanel` と同型）。
- `handleOpenAddCurrent = useCallback(async () => { const ok = await addCurrent.open(); if (ok) { setAddCurrentPanelOpen(true); enterPanel(); } }, [...])`。
- `SearchHeader` の「＋追加」に `onClick={handleOpenAddCurrent}` を配線（新規 prop `onAddCurrent`）。
- document keydown ハンドラの LIST 分岐に `shortcutIntent === 'add-current'` を追加し `handleOpenAddCurrent()` を呼ぶ（`void` 実行。`results.length` に依存しない＝結果0件でも常に有効）。
- PANEL モード分岐を `addCurrentPanelOpen` で分岐する:
  ```ts
  } else if (currentMode === 'PANEL') {
    if (addCurrentPanelOpen) {
      const intent = resolveKeyIntent('PANEL', e);
      if (intent === 'panel:close') {
        e.preventDefault();
        addCurrentActionsRef.current?.close();
      }
      return; // 他のキー(Tab・文字入力・矢印)は各フィールドが自己完結して処理する
    }
    if (bulkMovePanel) { ... } // 既存 MovePanel(一括) 分岐
    // 既存 MovePanel(単一) 分岐
  }
  ```
- `addCurrentActionsRef`（`useRef<{ close: () => void } | null>`）を追加し `AddCurrentPanel` の `actionsRef` に渡す。`close` の実体は「`setAddCurrentPanelOpen(false)`→`addCurrent.reset()`→`focusSearch()`」。
- `AddCurrentPanel` を `mode.mode === 'PANEL' && addCurrentPanelOpen && addCurrent.entry !== null` のときだけ描画する（`movePanelItem`/`selectedItems` と同じ「対象が消えたら描画しない」規律）。
- `useEffect`: `addCurrentPanelOpen && addCurrent.entry === null` になったら自動で閉じる（`remove()` 完了時の後始末。`movePanelItem===null` の既存 effect と同型）。
- エラートースト: `undo.pending ? ... : rowActions.error ? ... : addCurrent.error ? <Toast .../> : null` の分岐を追加する。

## 主要な設計判断

1. **新規モードを増やさず `PANEL` を共用する**: U13 の `bulkMovePanel` フラグが確立した前例に倣う。モード数を増やさないことで `modeMachine.ts`（既にテスト済みの中核）への変更ゼロで新機能を追加でき、リグレッションリスクを最小化する。
2. **破壊的操作は既存 `useRowActions` に委譲する**: 疑似 `SearchResultItem` を組み立てるコストは小さく、削除・移動の5秒アンドゥ・索引更新ロジックの重複を避けられる（development-guidelines のアンドゥ必須ルールを自動的に満たす）。
3. **Escape は document レベルの命令ハンドルで処理する**: MovePanel で発生した「背景の結果行が Enter/Escape を奪う」不具合クラス（U12 修正済み）を、同じオーバーレイ構造を持つ本パネルでも構造的に回避する。フィールド内の自己完結キー処理（タイトル入力のネイティブ挙動・折りたたみ式フォルダ検索の `stopPropagation`・`AliasEditor` の既存自己完結）は変更しない。
4. **フォルダ選択は「現在の親を無効化しない」**: `MovePanel`（移動)とは異なり、新規登録の初期フォルダ選択に「戻れない選択肢」を作る理由がない。`currentParentId=null` を渡すことで全フォルダを選択可能にする。
5. **デザイン非該当領域は既存トークンの忠実な組み合わせで新規設計する**: `docs/design/` にモックが無いため、`MovePanel`（オーバーレイ・カード）と `AliasEditor`（チップ入力）の確立済み視覚言語を組み合わせ、独自の配色・寸法を持ち込まない。

## テスト方針

- `BookmarkService.findByUrl` はデータ層の薄いラッパのため、直接テストは持たない（既存 `BookmarkService` の他メソッドと同方針。chrome API モックのユニットテストは行わない）。
- `useAddCurrent`（React 層）は直接テストしない（既存 `useRowActions` と同方針）。ただし本単位で導入する条件分岐（既存/新規判定・エラー判定）はロジックが薄いため、`validateUrl`（既存 `inlineEditModel.test.ts` で担保済み）の再利用で実質的にカバーされる。
- 品質ゲート: `pnpm test` / `pnpm lint` / `pnpm type-check`（前景で実 exit code 確認）。
