# 設計書 — U8a focus-three-state

## アーキテクチャ概要

U8 の構造（純粋ロジック = `modeMachine.ts` / React 橋渡し = `useMode.ts` / 実行 = `Popup.tsx` の document レベル単一リスナー）を維持したまま、**フォーカス位置の軸を1本追加する**。

```
Popup.tsx  [UI層・document keydown 単一リスナー]
  ├ state: listFocus ('search' | 'result')      ← 本単位で追加
  ├ useMode(): mode ('LIST' | 'FOLDER_TREE' | ...)
  │
  ├ resolveKeyIntent(mode, e, listFocus) ──► KeyIntent
  │     └ 実行（選択行移動 / ペイン移動 / 開く / 段階戻り）
  │
  └ resolveEscapeStep({ focusArea, hasQuery, hasScope }) ──► 1段分の戻り操作
        focusArea = toFocusArea(mode, listFocus)
```

**フォーカス3状態の表現**:

| フォーカス位置 | `mode` | `listFocus` | `focusArea`（導出） | DOM フォーカス |
|---|---|---|---|---|
| 検索ボックス | `LIST` | `'search'` | `'search'` | `<input>` |
| 右ペイン | `LIST` | `'result'` | `'result'` | body（input を `blur()`） |
| 左ペイン | `FOLDER_TREE` | （不問） | `'folderTree'` | body |

**初期値について**: PRD 機能1/6 では起動時の既定フォーカスは**左ペイン**だが、左ペインがキーボード操作可能になるのは U11 のため、本単位では暫定的に `LIST` + `listFocus='search'` を初期値とする（`↑↓` が無反応なペインへ着地させないため）。U11 が左ペイン操作の実装と同時に既定値を切り替え、U19 が保存状態からの復元を被せる。この暫定措置は `Popup.tsx` の初期値1箇所に閉じており、切り替えコストは小さい。

**DOM フォーカスは検索ボックスのみが持つ。** 右ペイン・左ペインは document レベルのリスナーで処理するため DOM フォーカスを移さない（U7/U8 の既存方式を踏襲）。検索欄を離脱する際に `blur()` するのは、キャレットを外して `←→` をペイン移動に使えるようにするためであり、これが本単位の要となる副作用。

## コンポーネント設計

### 1. `modeMachine.ts`（純粋ロジック・本単位の中核）

**責務**: モード遷移とキー意味論（インテント）の単一の source of truth。React / `chrome.*` に非依存。

#### 型の追加

```ts
type Mode = 'LIST' | 'FOLDER_TREE' | 'INLINE_EDIT' | 'ALIAS_EDIT' | 'DRAG' | 'PANEL';

/** LIST モード内のフォーカス位置。FOLDER_TREE では左ペインが自明のため参照しない。 */
type ListFocus = 'search' | 'result';

/** キー意味論・Escape 段階戻りが参照する統合フォーカス位置。 */
type FocusArea = 'search' | 'result' | 'folderTree';

/** mode と listFocus から統合フォーカス位置を導出する（両者の二重管理を避ける）。 */
const toFocusArea = (mode: Mode, listFocus: ListFocus): FocusArea =>
  mode === 'FOLDER_TREE' ? 'folderTree' : listFocus;
```

**実装の要点**:
- `FocusArea` を `Mode` と `ListFocus` から**導出**することで、「左ペインにフォーカスがある」状態が2箇所で食い違うことを防ぐ。`focusArea` を独立した state として持たない。
- `ListFocus` は Popup の state とする（DOM の `blur()`/`focus()` と密結合するため）。`useMode` には持たせない。

#### `ModeAction` / `modeReducer`

```ts
type ModeAction =
  | { type: 'ENTER_FOLDER_TREE' }          // 追加
  | { type: 'ENTER_INLINE_EDIT'; targetId: string }
  | ...;
```

- `ENTER_FOLDER_TREE` は **LIST からのみ**許可（既存の防御的デフォルトに合わせ、不正遷移は現状維持に倒す）。
- `EXIT_TO_LIST` は既存のまま。FOLDER_TREE からも LIST に戻れる。

#### `KeyIntent` の追加・改名

```ts
type KeyIntent =
  | 'none'
  // LIST（検索ボックス）
  | 'list:leave-search-up'      // ↑: 検索欄を離脱しつつ選択行を1つ上へ
  | 'list:leave-search-down'    // ↓: 検索欄を離脱しつつ選択行を1つ下へ
  // LIST（右ペイン）
  | 'list:move-up' | 'list:move-down'
  | 'list:to-folder-tree'       // ←: 左ペインへ
  // LIST 共通
  | 'list:open'
  // FOLDER_TREE
  | 'folder:move-up' | 'folder:move-down'
  | 'folder:parent'             // ←: 親フォルダへ
  | 'folder:to-result'          // →: 右ペインへ
  | 'folder:toggle-expand'      // Enter: 展開/折りたたみ
  | 'folder:home'               // Home: 「すべて」へ
  // LIST / FOLDER_TREE 共通
  | 'escape:step-back'          // 旧 'list:escape' から改名
  // 既存（変更なし）
  | 'inline:confirm' | 'inline:discard'
  | 'alias:candidate-up' | 'alias:candidate-down' | 'alias:confirm' | 'alias:exit'
  | 'panel:candidate-up' | 'panel:candidate-down' | 'panel:confirm' | 'panel:close'
  | 'drag:cancel';
```

**改名の理由**: `list:escape` は LIST 専用の名前だが、FOLDER_TREE も同じ段階戻りの梯子を共有する。`escape:step-back` にすることで「1段だけ戻せ」という意味が明確になり、`resolveEscapeStep` との対応も取れる。

#### `resolveKeyIntent(mode, e, listFocus)`

```ts
const resolveKeyIntent = (mode: Mode, e: KeyLike, listFocus: ListFocus): KeyIntent
```

| モード / フォーカス | `↑` | `↓` | `←` | `→` | `Enter` | `Home` | `Escape` |
|---|---|---|---|---|---|---|---|
| LIST + `search` | `list:leave-search-up` | `list:leave-search-down` | `none` | `none` | `list:open` | `none` | `escape:step-back` |
| LIST + `result` | `list:move-up` | `list:move-down` | `list:to-folder-tree` | `none` | `list:open` | `none` | `escape:step-back` |
| FOLDER_TREE | `folder:move-up` | `folder:move-down` | `folder:parent` | `folder:to-result` | `folder:toggle-expand` | `folder:home` | `escape:step-back` |
| INLINE_EDIT / ALIAS_EDIT / PANEL / DRAG | （既存のまま） | | | | | | |

**実装の要点**:
- LIST + `search` の `←→` / `Home` が `none` を返すことが**受け入れ条件そのもの**（クエリ途中の修正を担保）。`preventDefault` されないためネイティブのキャレット移動が生きる。
- `Enter` は既存どおり修飾なしのみ `list:open`。`Ctrl/Cmd+Enter` は `none`（新規タブは対応単位で別途）。
- 左ペインの各インテントは**定義のみ**。実行結線は U11（本単位では `folder:to-result` のみ結線する。ペイン移動の受け入れ条件に必要なため）。

#### `resolveEscapeStep`（旧 `resolveListEscape` を改名・拡張）

```ts
interface EscapeContext {
  focusArea: FocusArea;
  hasQuery: boolean;
  hasScope: boolean;
}
type EscapeStep = 'focus-search' | 'clear-keyword' | 'clear-scope' | 'close';

const resolveEscapeStep = (ctx: EscapeContext): EscapeStep => {
  if (ctx.focusArea !== 'search') return 'focus-search';  // 1段目（本単位で追加）
  if (ctx.hasQuery) return 'clear-keyword';
  if (ctx.hasScope) return 'clear-scope';
  return 'close';
};
```

**実装の要点**: 4段階の梯子を1関数に閉じ込め、Popup 側に条件分岐を散らさない。`resolveKeyIntent` は Escape に対し常に `escape:step-back` を返し、「どの段か」は本関数だけが決める。

#### `isSearchFirstExempt`

変更なし（`INLINE_EDIT | ALIAS_EDIT | PANEL` のみ）。`FOLDER_TREE` は**対象外にしない**＝左ペインで印字文字を打つと検索へ復帰する。この意図をテストで固定する。

### 2. `useMode.ts`

**責務**: `modeMachine` を React へ橋渡しする薄い層。

**変更内容**:
- `enterFolderTree()` を追加する。
- `resolveKey` のシグネチャを `(e: KeyLike, listFocus: ListFocus) => KeyIntent` に拡張する（`listFocus` は Popup が保持するため引数で受け取る）。

**実装の要点**: `listFocus` を `useMode` の内部 state にしない。DOM の `focus()`/`blur()` と同期して更新する必要があり、入力欄の ref を持つ Popup が所有するのが自然なため。`useMode` は「モードのみを扱う」という既存の責務範囲を維持する。

### 3. `Popup.tsx`

**責務**: インテントの実行と DOM フォーカスの操作。

**変更内容**:

```ts
const [listFocus, setListFocus] = useState<ListFocus>('search');

/** 検索ボックスへフォーカスを戻す（FOLDER_TREE からの復帰も兼ねる）。 */
const focusSearch = useCallback(() => {
  exitToList();                      // FOLDER_TREE なら LIST へ
  setListFocus('search');
  searchInputRef.current?.focus();
}, [exitToList]);

/** 検索欄を離脱し、同時に選択行を1つ動かす。blur でキャレットを外すのが要点。 */
const leaveSearch = useCallback((delta: -1 | 1) => {
  setListFocus('result');
  searchInputRef.current?.blur();
  setSelectedIndex(i => clamp(i + delta));
}, [lastIndex]);
```

インテントの実行対応:

| インテント | 実行内容 |
|---|---|
| `list:leave-search-up` / `-down` | `leaveSearch(-1)` / `leaveSearch(+1)` |
| `list:move-up` / `-down` | 選択行を ±1（端でクランプ） |
| `list:to-folder-tree` | `enterFolderTree()` |
| `folder:to-result` | `exitToList()` + `setListFocus('result')` |
| `list:open` | `openAt(selectedIndex)`（既存） |
| `escape:step-back` | `resolveEscapeStep(...)` の結果を実行 |
| `folder:move-*` / `folder:parent` / `folder:toggle-expand` / `folder:home` | **本単位では未結線**（U11） |

Escape 実行:

```ts
const step = resolveEscapeStep({
  focusArea: toFocusArea(currentMode, listFocus),
  hasQuery: query.trim().length > 0,
  hasScope: selectedFolderId !== null,
});
// 'focus-search' → focusSearch() / 'clear-keyword' → setQuery('')
// 'clear-scope'  → setSelectedFolderId(null) / 'close' → window.close()
```

検索ファースト復帰（既存ロジックの拡張）:
- 条件は既存どおり（`!isSearchFirstExempt(mode)` かつ入力欄外 かつ 印字文字 かつ スペース以外）。
- 復帰時に `focusSearch()` を呼ぶ形へ変更し、`listFocus` を `'search'` に戻す／FOLDER_TREE なら LIST へ戻すことを同時に行う。

左ペインの視覚的フィードバック:
- `sidebar` に渡すノードを Popup 側でラップし、`mode === 'FOLDER_TREE'` のときフォーカスリングを付ける。
- **`FolderTree.tsx` は変更しない**（U8a の対象領域は3ファイル。ツリー内のフォーカス表示は U11）。

マウス操作との共存（既存ガードの維持）:
- `list:open` 時の「DOM フォーカスがボタン上ならネイティブの活性化に委ねる」ガードは**維持する**。📎 ボタンをクリック後に `Enter` を押した場合、ネイティブのボタン活性化を優先する（U7 のマウス操作を壊さないため）。

## データフロー

### 検索して開く（最短経路）
```
1. 起動 → listFocus='search', mode=LIST, 入力欄にフォーカス
2. 文字入力 → インクリメンタル検索（選択行は常に先頭=0）
3. Enter → resolveKeyIntent(LIST, Enter, 'search') = 'list:open' → openAt(0)
```

### 左ペインへ行って戻る
```
1. listFocus='search' で ↓ → 'list:leave-search-down'
   → blur() + listFocus='result' + 選択行 +1
2. ← → 'list:to-folder-tree' → enterFolderTree() → mode=FOLDER_TREE
   → sidebar にフォーカスリング
3. → → 'folder:to-result' → exitToList() + listFocus='result'
4. 文字入力 → 検索ファースト復帰 → focusSearch()（mode=LIST, listFocus='search'）
```

### Escape の段階戻り
```
mode=FOLDER_TREE, query='docs', scope=あり の状態で Escape を連打:
1回目: focusArea='folderTree' → 'focus-search'  → 検索ボックスへ
2回目: focusArea='search', hasQuery → 'clear-keyword' → クエリクリア
3回目: hasScope → 'clear-scope' → 「すべて」へ
4回目: → 'close' → ポップアップを閉じる
```

## エラーハンドリング戦略

### カスタムエラークラス
新規に定義するものはない。

### エラーハンドリングパターン
- `modeMachine` は純粋関数群であり例外を投げない。未定義のキー・不正なモード遷移は `none` / 現状維持に倒す（既存の防御的デフォルトを踏襲）。
- `searchInputRef.current` が `null` の場合（アンマウント直後等）は `?.` で安全に無視する。
- IME 変換中（`e.isComposing`）は既存どおり全キー処理をスキップする。`↑↓` による検索欄離脱も変換中は発火させない（変換候補の選択と衝突するため）。

## テスト戦略

### ユニットテスト（`pages/popup/src/hooks/modeMachine.test.ts`）

**追加**:
- `modeReducer`: `ENTER_FOLDER_TREE` が LIST からのみ有効／非 LIST からは現状維持／FOLDER_TREE からの `EXIT_TO_LIST` で LIST に戻る。
- `resolveKeyIntent` LIST + `search`: `↑↓` = leave-search 系／**`←→` と `Home` が `none`**（キャレット温存の担保）／`Enter` = open／`Escape` = step-back。
- `resolveKeyIntent` LIST + `result`: `↑↓` = move 系／`←` = to-folder-tree／`→` = none／`Enter` = open。
- `resolveKeyIntent` FOLDER_TREE: `↑↓` / `←` / `→` / `Enter` / `Home` / `Escape` の全割り当て。
- `toFocusArea`: mode と listFocus からの導出（3状態）。
- `resolveEscapeStep`: 4段階すべて（focusArea 優先 → キーワード → スコープ → close）。
- `isSearchFirstExempt`: `FOLDER_TREE` が**対象外ではない**（＝検索へ復帰する）ことを固定。

**既存テストの是正**:
- `list:escape` → `escape:step-back` への改名に追随。
- `resolveListEscape` → `resolveEscapeStep` への改名と `focusArea` 追加に追随（既存3ケースは `focusArea: 'search'` を与える）。
- `resolveKeyIntent` の第3引数追加に追随（LIST 系は `'search'` / `'result'` を明示）。

### 統合テスト
本単位では追加しない。Popup の DOM フォーカス挙動（`blur()`/`focus()`）は E2E の領域であり、`docs/functional-design.md`「テスト戦略 > E2E」で扱う。

## 依存ライブラリ

新規追加なし。

## ディレクトリ構造

```
pages/popup/src/hooks/modeMachine.ts        [変更] Mode/ListFocus/FocusArea・インテント追加・resolveEscapeStep
pages/popup/src/hooks/modeMachine.test.ts   [変更] 上記の網羅テスト追加 + 既存テストの改名追随
pages/popup/src/hooks/useMode.ts            [変更] enterFolderTree 追加・resolveKey シグネチャ拡張
pages/popup/src/Popup.tsx                   [変更] listFocus state・ペイン移動・4段階Escape・sidebar フォーカスリング
```

新規ファイルの作成はない。`FolderTree.tsx` / `FolderTreeItem.tsx` / `SearchHeader.tsx` / `ResultList.tsx` は変更しない。

## 実装の順序

1. `modeMachine.ts` — 型（`Mode`/`ListFocus`/`FocusArea`/`toFocusArea`）とインテントの追加、`resolveKeyIntent` の3引数化、`resolveEscapeStep` への改名・拡張、`ENTER_FOLDER_TREE`
2. `modeMachine.test.ts` — 新仕様のテスト追加 + 既存テストの追随（純粋ロジックを先に固めてから UI を繋ぐ）
3. `useMode.ts` — `enterFolderTree` と `resolveKey` シグネチャ
4. `Popup.tsx` — `listFocus` state と各インテントの実行、Escape 4段階、検索ファースト復帰、sidebar フォーカスリング
5. `pnpm test` / `pnpm lint` / `pnpm type-check`

> 純粋ロジック → テスト → React 橋渡し → UI の順にすることで、型エラーが結線漏れの検出器として働く（U6a と同じ方針）。

## セキュリティ考慮事項

- 本単位に外部通信・権限・ストレージへの変更はない。外部通信ゼロ・最小権限の方針に影響しない。

## パフォーマンス考慮事項

- 追加するのは `listFocus`（文字列 state）1つと純粋関数の分岐のみ。キー入力ごとの計算量は変わらず、PRD の性能要件（起動→フォーカス 200ms / 1,000件で1文字あたり 100ms）に悪化要因はない。
- `blur()`/`focus()` は入力欄1要素に対する呼び出しであり、再描画コストへの影響は無視できる。

## 将来の拡張性

- `FocusArea` を `Mode` × `ListFocus` から導出する形にしたため、将来ペインが増えた場合も導出関数の1箇所を変えれば済む。
- 左ペインのインテント（`folder:*`）を先に定義しておくことで、U11 は `Popup.tsx` に実行を結線するだけでよく、キー割り当ての再設計が不要になる。
- `Ctrl/Cmd+Enter`（新規タブ）は `resolveKeyIntent` に `list:open-new-tab` を足すだけで拡張できる位置に構造を残す（本単位では追加しない）。
