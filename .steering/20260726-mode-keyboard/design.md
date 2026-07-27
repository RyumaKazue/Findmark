# 設計書 — U8 mode-keyboard

## アーキテクチャ概要

Popup UI 内に**純粋なモードマシン（ロジック）**と**それを React に橋渡しするフック**の2層を新設する。キーの意味論（どのモードで ↑↓/Enter/Escape が何を意味するか）はすべて純粋関数に閉じ込め、ユニットテストで網羅する。React 側（`useMode` / Popup / SearchHeader）は純粋関数の結果（インテント）を実行するだけにする。

```
pages/popup/src
├── hooks/
│   ├── modeMachine.ts        ← 【新規・純粋】Mode型 / reducer / resolveKeyIntent / resolveListEscape /
│   │                            isPrintableKey / SHORTCUTS。chrome/React 非依存
│   ├── modeMachine.test.ts   ← 【新規】上記の全モード・全キーの網羅テスト（vitest）
│   └── useMode.ts            ← 【新規・React】useReducer で modeMachine を保持し、遷移 API とキー解決を公開
├── Popup.tsx                 ← 【変更】useMode を導入し LIST 挙動を置換（↑↓/Enter/段階Escape/検索ファースト）
└── components/
    └── SearchHeader.tsx      ← 【変更】キー処理を useMode のキー解決経由へ。onEscape / inputRef を受け取る
```

**レイヤー遵守**: `modeMachine.ts` は純粋（`chrome.*`・React 非依存）で、`packages/*` の pure module（`folderTreeModel.ts` / `virtualization.ts`）と同じ位置づけ。UI から Chrome API を直接触らない原則は維持（「開く」は従来どおり `bookmarkService.openUrl`）。

## キー割り当ての出典と整合

キー操作の**振る舞い（behavior）の正**は functional-design「画面遷移図 / モード別のキー挙動 / 共通ルール」とする。design README のインタラクション表は**視覚仕様の正**だが、モード入口を素キー `E`（インライン編集）/ `A`（別名編集）に割り当てている。これは Findmark 中核の**検索ファースト**（「文字を打てば検索ボックスにフォーカスが戻る」）と**両立しない**（検索ボックスにフォーカスがある状態で `e`/`a` を打つと検索語になるべき）。したがって U8 は functional-design の**修飾キー方式**を採用する:

| 入口 | 採用ショートカット（functional-design） | design README（非採用の素キー） |
|---|---|---|
| INLINE_EDIT | `F2` / `Ctrl+E` | `E` / 行ダブルクリック |
| ALIAS_EDIT | `Ctrl+;` | `A` / 別名エリアクリック |
| PANEL（フォルダ選択） | `Ctrl+M` | （README 記載なし） |

> ダブルクリック / 別名エリアクリック等の**マウス起点の入口**は、UI 実体を持つ後続単位（U10/U9）が該当コンポーネント側で `enterInlineEdit`/`enterAliasEdit` を呼べばよい（モードマシンはマウス経路に非依存）。本整合は functional-design「UI設計 > デザイン非採用項目」の precedence（視覚=design、挙動=functional-design/実装）に沿う。

## コンポーネント設計

### 1. modeMachine.ts（純粋ロジック）

**責務**:
- モード種別・状態・遷移の定義（single source of truth）。
- モードごとのキー→インテント解決。
- LIST の段階的 Escape 解決。
- 検索ファーストのための印字キー判定。

**型と関数（要点）**:

```typescript
export type Mode = 'LIST' | 'INLINE_EDIT' | 'ALIAS_EDIT' | 'DRAG' | 'PANEL';

export interface ModeState {
  mode: Mode;
  targetId: string | null; // 編集/操作対象の行 ID（LIST/DRAG は null 可）
}

export const initialModeState: ModeState = { mode: 'LIST', targetId: null };

export type ModeAction =
  | { type: 'ENTER_INLINE_EDIT'; targetId: string }
  | { type: 'ENTER_ALIAS_EDIT'; targetId: string }
  | { type: 'ENTER_PANEL' }
  | { type: 'ENTER_DRAG'; targetId: string | null }
  | { type: 'EXIT_TO_LIST' };

export function modeReducer(state: ModeState, action: ModeAction): ModeState;

// モードごとのキー意味論。UI はこの結果（intent）を実行するだけ。
export type KeyIntent =
  | 'none'
  | 'list:move-up' | 'list:move-down' | 'list:open' | 'list:escape'
  | 'inline:confirm' | 'inline:discard'
  | 'alias:candidate-up' | 'alias:candidate-down' | 'alias:confirm' | 'alias:exit'
  | 'panel:candidate-up' | 'panel:candidate-down' | 'panel:confirm' | 'panel:close'
  | 'drag:cancel';

export interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; }

export function resolveKeyIntent(mode: Mode, e: KeyLike): KeyIntent;

// LIST の Escape の段階戻り。文脈から次の1手を返す（副作用なし）。
export interface ListEscapeContext { hasQuery: boolean; hasScope: boolean; }
export type ListEscapeAction = 'clear-keyword' | 'clear-scope' | 'close';
export function resolveListEscape(ctx: ListEscapeContext): ListEscapeAction;

// 検索ファースト: 印字文字か（修飾キー付き・機能キー・IME 変換中は false）。
export interface PrintableKeyLike extends KeyLike { isComposing?: boolean; }
export function isPrintableKey(e: PrintableKeyLike): boolean;

// モード入口ショートカット定数（一箇所集約）。
export const SHORTCUTS: { /* inlineEdit / aliasEdit / panel の判定用ラベル */ };
// 対象行 ID は遷移時に呼び出し側が与えるため、ショートカットは「意図」のみ返す。
export type ShortcutIntent = 'inline-edit' | 'alias-edit' | 'panel';
export function resolveShortcutIntent(e: KeyLike): ShortcutIntent | null;

// 検索ファースト復帰の対象外モード（自前の文字入力 UI を持つモード）。Popup にハードコードせず純粋関数に集約。
export function isSearchFirstExempt(mode: Mode): boolean; // INLINE_EDIT / ALIAS_EDIT / PANEL
```

> 実装補足: モード入口ショートカットは `ENTER_*` アクション（`targetId` を要する）ではなく **意図（`ShortcutIntent`）** を返す。`targetId` は現在の対象行に依存するため、呼び出し側（後続単位）が `enterInlineEdit(targetId)` 等に添えて渡す。

**実装の要点**:
- `resolveKeyIntent`: `Escape` は LIST では `'list:escape'` を返す（段階解決は `resolveListEscape` に委譲）。INLINE_EDIT の ↑↓ はネイティブのキャレット移動に任せるため `'none'`（intent を生成しない）。DRAG は Escape 以外すべて `'none'`。
- `resolveListEscape`: `hasQuery ? 'clear-keyword' : hasScope ? 'clear-scope' : 'close'`。
- `isPrintableKey`: `e.ctrlKey||e.metaKey||e.altKey` は false / `e.isComposing` は false / `e.key.length === 1`（`'a'`,`'あ'` 等の単一文字）を印字とみなす（`Enter`/`Tab`/`ArrowX` 等は `.length>1` で除外）。
- `resolveShortcutAction`: `F2`→INLINE_EDIT、`Ctrl+E`→INLINE_EDIT、`Ctrl+;`→ALIAS_EDIT、`Ctrl+M`→PANEL。`targetId` を要する遷移は「対象なし時は null を返す」設計にし、呼び出し側（後続単位）が対象を与える。U8 では resolve のみ提供し、Popup での実配線は LIST 系に限定。

### 2. useMode.ts（React フック）

**責務**:
- `useReducer(modeReducer, initialModeState)` でモード state を保持。
- 遷移コールバック（`enterInlineEdit`/`enterAliasEdit`/`enterPanel`/`enterDrag`/`exitToList`）を `useCallback` で公開。
- 現在モードに束ねたキー解決 `resolve(e)` を公開（= `resolveKeyIntent(state.mode, e)`）。

**公開インターフェース（要点）**:
```typescript
export interface UseModeApi {
  mode: Mode;
  targetId: string | null;
  enterInlineEdit: (targetId: string) => void;
  enterAliasEdit: (targetId: string) => void;
  enterPanel: () => void;
  enterDrag: (targetId?: string | null) => void;
  exitToList: () => void;
  resolveKey: (e: KeyLike) => KeyIntent; // 現在モードでのインテント解決
}
export function useMode(): UseModeApi;
```

**実装の要点**:
- 純粋ロジックは持ち込まず `modeMachine.ts` に委譲するだけの薄いフック（テストは主に modeMachine 側で担保）。

### 3. Popup.tsx（結線・LIST ライブ化 / document レベルの単一キーリスナー）

**責務**:
- `useMode()` を導入し、LIST 挙動を `resolveKey` のインテント実行に置換。
- **キー処理を `document` レベルの単一 `keydown` リスナー（`useEffect` で登録/解除）に集約**する。検索ボックス外（左ペインのフォルダボタン等）にフォーカスがあっても LIST のキー操作が一貫して効くようにするため（フォーカス依存を排除）。
- 段階 Escape を `resolveListEscape({ hasQuery, hasScope })` で実行:
  - `clear-keyword` → `setQuery('')`
  - `clear-scope` → `setSelectedFolderId(null)`
  - `close` → `window.close()`
- 検索ファースト復帰を同リスナー内で処理（下記データフロー）。

**実装の要点**:
- `hasQuery = query.trim().length > 0`、`hasScope = selectedFolderId !== null`。
- 既存の `selectedIndex` クランプ / 追従スクロール等は不変（回帰防止）。
- 他モードのライブ UI は無いため、U8 の Popup では enter 系を実配線しない（API は後続単位向けに公開済み）。後続単位（U9/U10/U12）はモードに入った後、自分の入力要素の `onKeyDown` で当該モードのインテントに応答する（document リスナーは LIST でのみインテントを実行）。
- `list:open` はフォーカスがフォルダボタン等にある場合、ネイティブの活性化（開閉/選択）に委ねる（`e.target.closest('button')` を判定）。
- IME 変換中（`e.isComposing`）は操作として扱わない（誤確定・誤クローズ防止）。

### 4. SearchHeader.tsx（キー処理の撤去・ref 公開）

**責務**:
- 自前の `handleKeyDown`（キー意味論）を撤去する。キー処理は Popup の document リスナーに一元化されるため、本コンポーネントはキーを扱わない。
- `inputRef`（`RefObject<HTMLInputElement | null>`）を親から受け取り、起動時フォーカスと検索ファースト復帰に使う。

**実装の要点**:
- props は `query` / `onQueryChange` / `inputRef` のみ。`<input>` は `onChange`（入力）と `ref` のみを持つ。

### 5. PopupShell.tsx

- 変更なし（U8 で追加した `onKeyDown` prop は不要になったため元に戻す）。非インタラクティブ `<div>` にキーハンドラを置くと `jsx-a11y/no-static-element-interactions` に触れるため、キーは `document` リスナーで受ける。

## データフロー

### LIST: ↑↓ / Enter（開く） — document レベル
```
1. document.keydown(e)（検索ボックス・フォルダボタン等どこにフォーカスがあっても発火）
2. currentMode === 'LIST' のとき intent = resolveKey(e)   // 'list:move-up'|'move-down'|'open'|'escape'
3. Popup が intent を実行: move-up/down → setSelectedIndex、open → openAt(selectedIndex)
   （open はフォーカスがボタン上なら native 活性化に委ねて return）
```

### LIST: 段階的 Escape
```
1. document.keydown(Escape) → intent 'list:escape'
2. action = resolveListEscape({ hasQuery, hasScope })
3. clear-keyword → setQuery('') / clear-scope → setSelectedFolderId(null) / close → window.close()
```

### 検索ファースト復帰
```
1. document.keydown(e)
2. isSearchFirstExempt(currentMode)（INLINE_EDIT/ALIAS_EDIT/PANEL）なら何もしない
3. フォーカスが検索 input でなく、印字文字（isPrintableKey・スペース除く）なら inputRef.current?.focus()
   （U8 ではフォーカス復帰までを保証。文字自体は検索ボックスへ移った次キーから反映される。
     LIST 既定では元々検索 box にフォーカスがあるため実害はなく、フォルダボタン等へフォーカスが
     逃げた場合の復帰と、後続単位で編集→LIST 復帰時の保険として機能する）
```

## エラーハンドリング戦略

- モードマシンは純粋関数のため例外を投げない。未知のキー/不正遷移は「`'none'` / 現状維持」に倒す（防御的デフォルト）。
- `window.close()` はポップアップ文脈でのみ有効。テストでは `resolveListEscape` の戻り値（`'close'`）を検証し、`window.close` 実行自体はテスト対象外（副作用は Popup 側の薄い分岐）。

## テスト戦略

### ユニットテスト（modeMachine.test.ts, vitest）
- `modeReducer`: 各 ENTER_* が正しいモード・`targetId` に遷移し、`EXIT_TO_LIST` で LIST/null に戻る。二重遷移や LIST での EXIT が安全（現状維持）。
- `resolveKeyIntent`: 全5モード × ↑↓/Enter/Escape のインテントを網羅（上表どおり）。DRAG は Escape 以外 `'none'`。修飾キー付き Enter は LIST で `'list:open'` を汚さない等の境界。
- `resolveListEscape`: `{query,scope}` の4組合せで `clear-keyword`/`clear-scope`/`close` を返す。
- `isPrintableKey`: `'a'`/`'あ'`=true、`Ctrl+a`/`Meta+a`/`Alt+a`=false、`Enter`/`ArrowDown`/`Tab`/`Escape`=false、`isComposing:true`=false。
- `resolveShortcutAction`: `F2`/`Ctrl+E`→INLINE_EDIT、`Ctrl+;`→ALIAS_EDIT、`Ctrl+M`→PANEL、無関係キー→null。

### 統合テスト（本単位では自動化しない）
- Popup での LIST ↑↓/Enter/段階Escape は既存 E2E 導線（U7）とあわせて手動確認。E2E 自動化は後続でまとめて実施（U18 品質ゲート）。

## 依存ライブラリ

新規追加なし（React 標準の `useReducer`/`useCallback` と既存 vitest のみ）。

## ディレクトリ構造

```
pages/popup/src/
├── hooks/
│   ├── modeMachine.ts        （新規）
│   ├── modeMachine.test.ts   （新規）
│   ├── useMode.ts            （新規）
│   └── useSearch.ts          （変更なし）
├── Popup.tsx                 （変更）
└── components/
    └── SearchHeader.tsx      （変更）
```

## 実装の順序

1. `modeMachine.ts`（型・reducer・resolveKeyIntent・resolveListEscape・isPrintableKey・SHORTCUTS/resolveShortcutAction）
2. `modeMachine.test.ts`（全モード・全キー・境界を網羅）
3. `useMode.ts`（reducer 保持 + 遷移 API + resolveKey）
4. `SearchHeader.tsx` 変更（onEscape / inputRef / IME 考慮）
5. `Popup.tsx` 変更（useMode 結線・段階Escape・検索ファースト復帰）
6. 品質チェック（test/lint/type-check）

## セキュリティ考慮事項

- 外部通信・新規権限なし。純粋なUIロジックのみ。`chrome.*` 直接呼び出しを増やさない（レイヤー遵守）。

## パフォーマンス考慮事項

- モード解決は同期の純粋関数で O(1)。再描画は既存の state（query/selectedIndex/selectedFolderId）に加えモード state が増えるのみ。LIST 常駐時はモードが変わらないため追加再描画は発生しない。

## 将来の拡張性

- `KeyIntent` に各モードのインテントを列挙済みのため、U9/U10/U12/U13 は「自分のモードのインテントに応答する」だけで拡張できる。マウス起点の入口（ダブルクリック/別名クリック/ドラッグ開始）も enter* を呼ぶだけでモードに乗る。
- 将来 Ctrl/⌘+Enter（新規タブ）や複数選択（1f）を足す際も、キー意味論は `resolveKeyIntent` の1箇所拡張で対応できる。
