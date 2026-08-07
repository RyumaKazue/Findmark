# 設計: U11 folder-scope-tree

- **作業単位ID / 名**: U11 / `folder-scope-tree`
- **作成日**: 2026-07-28
- **前提**: [requirements.md](./requirements.md) / [architecture.md](../../docs/architecture.md)（UI → サービス → データ）

---

## 1. 設計方針

### 方針1: 「スコープ = 左ペインのフォーカス位置」で二重管理を消す

U8a の残課題（マウス操作と内部フォーカスモデルの不一致）は、**状態を1つに畳む**ことで構造的に解消する。

```
scopeFolderId: string | null      // null = 「すべて」
   ├─ 左ペインのフォーカス行（= ハイライト位置）
   ├─ 右ペインの絞り込み範囲（useSearch へ渡す folderId）
   └─ 検索ボックスのフォルダチップの表示元
```

キーボード（`↑↓`/`←`/`Home`）もマウス（フォルダ名クリック）も、**この1つの state だけを更新する**。
「さらに N 件…」行にフォーカスがある場合のみ例外的にフォルダ行と一致しないため、
フォーカス行は `focusRowKey: string | null` として別に持たず、
**`scopeFolderId` + 「more 行にいるか」の補助 state（`focusedMoreParentId`）** で表す（下記 4.2）。

### 方針2: ツリーの計算はすべて純粋関数へ（`folderTreeModel.ts`）

`FolderTree.tsx` は「取得 → 純粋関数で可視行を算出 → 描画」に徹する。
可視行の平坦化・親解決・祖先収集・パス生成/圧縮はすべて純粋関数としてユニットテストする
（既存 `folderTreeModel.ts` / `virtualization.ts` / `modeMachine.ts` と同じ流儀。宣言は非 export、ファイル末尾で export をまとめる）。

### 方針3: レイヤー依存の遵守

`FolderTree` は `chrome.*` を直接触らず、`bookmarkService`（U4）と `localStateStore`（U4）経由でのみアクセスする。
展開状態の永続は `packages/storage` の `localStateStore` に閉じる。

---

## 2. 変更対象ファイル

| ファイル | 種別 | 変更内容 |
|---|---|---|
| `packages/storage/lib/types.ts` | 変更 | `LocalState` に `isExpandedInitialized?: boolean` を追加 |
| `packages/storage/lib/impl/localStateStore.ts` | 変更 | `expandFolders(ids)`（祖先の一括展開）/ `initializeExpanded(ids)` を追加 |
| `packages/storage/lib/impl/stores.test.ts` | 変更 | 追加 API のテスト |
| `pages/popup/src/components/folderTreeModel.ts` | 変更 | 可視行の平坦化・親解決・祖先収集・パス生成/圧縮を追加 |
| `pages/popup/src/components/folderTreeModel.test.ts` | 変更 | 上記のテスト |
| `pages/popup/src/components/resultMetaModel.ts` | **新規** | 右ペインのメタ行文言（純粋） |
| `pages/popup/src/components/resultMetaModel.test.ts` | **新規** | 上記のテスト |
| `pages/popup/src/components/FolderTree.tsx` | 変更 | 永続展開・スコープ・可視行算出・DOMフォーカス受け・スクロール追従 |
| `pages/popup/src/components/FolderTreeItem.tsx` | 変更 | 押下対象の2分離・📎撤去・chevron ボタン・ハイライト・more 行 |
| `pages/popup/src/components/SearchHeader.tsx` | 変更 | フォルダチップ（表示専用）追加 / 起動時 autofocus 廃止 |
| `pages/popup/src/components/ResultList.tsx` | 変更 | メタ行（34px）の描画 |
| `pages/popup/src/Popup.tsx` | 変更 | `scopeFolderId` へ改称・初期モード `FOLDER_TREE`・`folder:*` インテント結線 |
| `pages/popup/src/hooks/useMode.ts` | 変更 | 初期モードを指定できるようにする（`useMode('FOLDER_TREE')`） |
| `docs/functional-design.md` | 変更 | デザイン非採用項目に #10（チップの `✕`）・#11（階層をたたむバー）を追記 |

`packages/shared`（SearchEngine）・`useSearch.ts` は**変更しない**（U6a で確定済みの直下のみ方式をそのまま使う）。

---

## 3. データモデル

### 3.1 `LocalState`（`packages/storage/lib/types.ts`）

```typescript
export interface LocalState {
  /** フォルダツリーの展開状態（フォルダ ID の配列）。 */
  expandedFolderIds: string[];
  /**
   * 展開状態の初期化済みフラグ（U11）。
   * 空配列だけでは「初回起動（既定で最上位を展開したい）」と「ユーザーが全て畳んだ」を区別できないため、
   * 初回に既定展開を書き込んだことを別に記録する。
   */
  isExpandedInitialized?: boolean;
  /** 現在ページ登録時の初期フォルダ（前回使用フォルダ）。 */
  lastUsedFolderId?: string;
}
```

### 3.2 `localStateStore` 追加 API

```typescript
/** 指定 ID 群を展開状態へ追加する（既存はそのまま。スコープ設定時の祖先自動展開に使う）。 */
expandFolders: (folderIds: string[]) => Promise<void>;
/** 初回のみ既定の展開状態を書き込む（`isExpandedInitialized` を立てる）。2回目以降は何もしない。 */
initializeExpanded: (folderIds: string[]) => Promise<void>;
```

`toggleExpanded` は既存のまま使う（トグル時にも `isExpandedInitialized` を立てる）。

---

## 4. 純粋ロジック設計（`folderTreeModel.ts`）

### 4.1 可視行の平坦化

```typescript
/** 左ペインの可視行1件（キーボード移動の単位）。 */
type TreeRow =
  | { kind: 'all' }                                                    // 「すべて」行（scope = null）
  | { kind: 'folder'; folder: FolderTreeNode; depth: number }          // フォルダ行（scope = folder.id）
  | { kind: 'more'; parentId: string; hiddenCount: number; depth: number }; // 「さらに N 件…」行

interface FlattenOptions {
  expandedIds: ReadonlySet<string>;
  /** 「さらに N 件…」を押して全件表示にした親フォルダ ID（非永続）。 */
  revealedIds: ReadonlySet<string>;
}

const flattenVisibleTree = (folders: FolderTreeNode[], options: FlattenOptions): TreeRow[]
```

- 先頭は必ず `{ kind: 'all' }`。
- 展開中（`expandedIds`）のフォルダのみ子を展開する。
- **深さ省略（design 2b）**: `depth >= TRUNCATE_DEPTH`（= 4、0 起点なので第5階層）の子グループは、
  親が `revealedIds` に無い限り先頭 `VISIBLE_CHILDREN`（= 2）件で打ち切り、`{ kind: 'more' }` を1行足す。

### 4.2 移動系

```typescript
/** 行のキー（React key / フォーカス同定用）。'all' | `f:${id}` | `more:${parentId}` */
const rowKey = (row: TreeRow): string

/** 現在の行キーから ±1 行移動した先の行を返す（端では null）。 */
const moveRow = (rows: TreeRow[], currentKey: string, delta: -1 | 1): TreeRow | null

/** 親フォルダ ID を返す（最上位フォルダ・不明は null）。 */
const findParentId = (folders: FolderTreeNode[], folderId: string): string | null

/** ルートから当該フォルダまでの祖先 ID（自身は含まない）。 */
const collectAncestorIds = (folders: FolderTreeNode[], folderId: string): string[]

/** ルートから当該フォルダまでのタイトル配列（自身を含む）。`/` を含む名前でも壊れない。 */
const findFolderPath = (folders: FolderTreeNode[], folderId: string): string[]
```

### 4.3 パス圧縮（design 2b）

```typescript
/**
 * 「先頭1階層 + … + 末尾2階層」に圧縮する。深さ4以下はそのまま（2a の表示）。
 * 例: ['開発','tools','samples','mv3','x'] → ['開発','…','mv3','x']
 */
const compressPath = (titles: string[]): string[]

/** 表示用に ` / ` で結合する（結合は表示時のみ。保持は常に配列 = AC-6）。 */
const formatPath = (titles: string[]): string
```

---

## 5. メタ行文言（`resultMetaModel.ts`・新規）

```typescript
interface ResultMetaInput {
  /** 圧縮済みのスコープパス。null = 「すべて」 */
  scopePath: string[] | null;
  /** trim 済みクエリ。空文字はブラウズ。 */
  query: string;
  count: number;
}

/** 右ペインのメタ行文言を組み立てる。null ならメタ行を描画しない（design 1a）。 */
const buildResultMetaLabel = (input: ResultMetaInput): string | null
```

| 条件 | 出力 |
|---|---|
| query あり・scope あり | `開発 / chrome の中から「docs」— 4件` |
| query あり・scope なし | `すべて の中から「docs」— 4件` |
| query なし・scope あり | `開発 / chrome の直下 — 5件` |
| query なし・scope なし | `null`（メタ行なし） |

---

## 6. コンポーネント設計

### 6.1 `FolderTree.tsx`

```typescript
interface FolderTreeProps {
  /** 現在のスコープ（null = すべて）。左ペインのフォーカス行でもある。 */
  scopeFolderId: string | null;
  /** スコープ変更（キーボード移動・フォルダ名クリックの両方から呼ばれる）。 */
  onScopeChange: (id: string | null) => void;
  /** 左ペインがフォーカスされているか（mode === 'FOLDER_TREE'）。 */
  focused: boolean;
  /** 取得したフォルダツリーを親へ渡す（チップ/メタ行のパス解決に使う）。 */
  onFoldersLoaded: (folders: FolderTreeNode[]) => void;
  /** キーボードインテントを受け取るための命令ハンドル。 */
  actionsRef: RefObject<FolderTreeActions | null>;
}

/** Popup の document リスナーから呼ばれる左ペイン操作（U8a の folder:* インテントの実行体）。 */
interface FolderTreeActions {
  moveFocus: (delta: -1 | 1) => void;   // folder:move-up / move-down
  focusParent: () => void;              // folder:parent
  toggleExpand: () => void;             // folder:toggle-expand（more 行では「残りを表示」）
  focusAll: () => void;                 // folder:home
}
```

**なぜ `actionsRef`（命令ハンドル）か**: 可視行の平坦化には `folders` / `expandedIds` / `revealedIds` が必要で、
これらは FolderTree のローカル state である。Popup へ持ち上げると U19（状態復元）まで含めて Popup が肥大化するため、
**キー処理は Popup（単一の document リスナー）に残しつつ、実行だけを子へ委譲**する。
`useImperativeHandle` 相当を `actionsRef` への代入で行う（既存 hooks の流儀に合わせ、追加ライブラリは使わない）。

**DOM フォーカスの扱い**:
- ルート `div` に `tabIndex={-1}` を置き、`focused === true` になったら `focus()` する（起動直後を含む）。
- 行内の `<button>` は `onMouseDown={e => e.preventDefault()}` でフォーカス奪取を抑止し、
  クリック時はルート `div` へフォーカスを戻す。これで**内部モデルと実 DOM フォーカスが常に一致**する（AC-8）。
- スコープ行が可視範囲外になったら `scrollIntoView({ block: 'nearest' })` で追従する。

**永続展開の初期化**:
1. `bookmarkService.getTree()` と `localStateStore.get()` を並行取得。
2. `isExpandedInitialized` が偽なら、最上位フォルダ ID を `initializeExpanded` で書き込み、それを初期展開とする。
3. 真なら `expandedFolderIds` をそのまま使う（空配列 = 全て畳んだ状態を復元）。

**スコープ変更時の祖先自動展開**: `onScopeChange` を受けた Popup が再描画 → `FolderTree` の effect が
`collectAncestorIds` の結果を `expandedIds` へマージし、`localStateStore.expandFolders` で永続化する。

### 6.2 `FolderTreeItem.tsx`

📎（`FolderSelectChip`）を削除し、行を2つの押下対象へ分ける。

```
┌────────────────────────────────────────┐
│ [⌄]  📁 chrome                          │   ← [⌄] = 展開トグル専用ボタン（hover 背景あり）
└────────────────────────────────────────┘     「📁 chrome」= スコープ選択ボタン（子なしでも押下可）
```

- **展開トグル**: 10×10 の chevron を描く `<svg>` を `<button>`（20×20・`rounded` ・`hover:bg-accent-bg`）に入れる。
  展開中は下向き、折りたたみ中は右向き。子を持たない行は同寸の空枠（ボタンにしない）でインデントを揃える。
  素の `▸`/`▾` を廃するのは「単体では押せると分からない」ため（AC-8）。
- **スコープ選択**: `📁`（展開中の親は `📂`）+ フォルダ名を1つの `<button>` にする。
  スコープ中は `bg-accent text-white font-bold`（design 1b/2a）。
- **「さらに N 件…」行**: `<button>`。フォーカス中は薄い背景でフォーカス位置を示す（accent 塗りにはしない＝スコープではない）。
- インデントガイド線は既存を踏襲（`border-l` + `depth` に応じた `ml`）。第4階層以降は詰める（design 2b）。

### 6.3 `SearchHeader.tsx`

- **起動時の `inputRef.current?.focus()` を削除**（AC-4。既定フォーカスは左ペイン）。
- `scopePath: string[] | null` を受け取り、非 null のとき検索ボックス先頭にチップを描く。
  - pill / height 22 / `bg-accent-bg` / `text-accent-strong` / `📁` + 圧縮済みパス（design 1b の寸法）。
  - **`✕` は描かない**（requirements「解釈で埋めた点」#1）。`aria-hidden` は付けず、
    `role` も持たない単なる `<span>`（操作要素にしない）。

### 6.4 `ResultList.tsx`

- `metaLabel?: string | null` を受け取り、非 null のとき高さ 34px のメタ行を**スクロールコンテナの外側上部**に描く。
- ルートを `flex h-full flex-col` にし、既存のスクロールコンテナを `flex-1 min-h-0` にする
  （仮想スクロールの `clientHeight` 計測は `ResizeObserver` があるためメタ行の出入りに追従できる）。

### 6.5 `Popup.tsx`

- `selectedFolderId` → **`scopeFolderId`** へ改称（docs の用語「スコープ」に揃える）。
- `useMode('FOLDER_TREE')` で**起動時の既定フォーカスを左ペイン**にする。
- `folder:*` インテントを `folderTreeActions` へ結線する:

| インテント | 実行 |
|---|---|
| `folder:move-up` / `folder:move-down` | `actions.moveFocus(-1 / +1)` |
| `folder:parent` | `actions.focusParent()` |
| `folder:toggle-expand` | `actions.toggleExpand()` |
| `folder:home` | `actions.focusAll()` |
| `folder:to-result` | 既存のまま（`exitToList()` + `setListFocus('result')`） |

- `folders`（FolderTree から受け取る）を使って `scopePath` を算出し、`SearchHeader` と `ResultList` へ渡す。

### 6.6 `useMode.ts`

`useReducer(modeReducer, initialModeState)` を `useReducer(modeReducer, initialMode, ...)` 形式に変え、
`useMode(initialMode: Mode = 'LIST')` で初期モードを選べるようにする。`modeMachine.ts` の遷移規則自体は変更しない。

---

## 7. キーボード操作フロー（結線後）

```
起動
  └─ mode=FOLDER_TREE / scope=null（すべて）/ 左ペインに DOM フォーカス
       ├─ ↓        → moveFocus(+1) → scope=最上位フォルダ → 右ペイン切替 + 選択行を先頭へ
       ├─ Enter    → toggleExpand()（子ありのみ）→ 永続化
       ├─ ←        → focusParent()（最上位では何もしない）
       ├─ Home     → focusAll() → scope=null
       ├─ →        → LIST + listFocus='result'（U8a 実装済み）
       ├─ 印字/BS  → 検索ボックスへ復帰（U8a 実装済み）
       └─ Escape   → 段階戻り（U8a 実装済み・focusArea='folderTree' → 検索ボックスへ）
```

---

## 8. 影響範囲と非機能

- **パフォーマンス**: 可視行の平坦化はフォルダ数に線形。ブックマークフォルダは通常数百件のため仮想化は不要
  （右ペインの仮想スクロールは既存のまま）。起動時フォーカスは `getTree()` の完了を待たずに当てるため 200ms 要件を満たす。
- **プライバシー**: 外部通信を追加しない。`chrome.storage.local` のみ。
- **アクセシビリティ**: 展開ボタンに `aria-expanded` / `aria-label`、スコープボタンに `aria-current="true"`（スコープ中）を付ける。
  ツリー全体には `role="tree"` / 行に `role="treeitem"` を付与し、キーボード操作は document リスナーが担う旨をコメントで残す。
- **後方互換**: `LocalState.isExpandedInitialized` は optional のため、既存の保存値をそのまま読める。

---

## 9. リスクと対処

| リスク | 対処 |
|---|---|
| `actionsRef` による命令的 API が React の流儀から外れる | 呼び出し元を Popup の document リスナー1箇所に限定し、JSDoc で理由（可視行の算出に必要な state が子側にあること）を明示 |
| メタ行追加で仮想スクロールの高さ計測がずれる | 既存 `ResizeObserver` が `clientHeight` を再計測するため追従する。メタ行はスクロールコンテナの外に置く |
| 起動時フォーカス変更で「開いてすぐ打つ」導線が壊れる懸念 | U8a の検索ファースト復帰（印字文字/`Backspace`）が既に実装済みで、1文字目から検索へ流れる |
| 深さ省略でフォルダに到達できなくなる | 「さらに N 件…」行をキーボード到達可能にし、`Enter` で全件表示する |
