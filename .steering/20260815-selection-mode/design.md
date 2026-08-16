# 設計書 — selection-mode

## アーキテクチャ概要

U13 の3層構成（純粋モデル → React フック → UI）をそのまま使い、**「選択モードか」という1つの真偽値を純粋モデルへ寄せる**ことで実現する。新しいレイヤー・新しい状態管理機構は増やさない。

```
selectionModel.ts (純粋)        ── { ids, anchorId, active } と遷移規則。不変条件 ids>0 ⇒ active
        │
useSelection.ts (React 層)      ── useState で保持し、selectionMode / enter / exit / toggleMode を公開
        │
Popup.tsx (結線)                ── ヘッダー差し替え・キー結線・一括操作後の自動終了
        │
SearchHeader / ResultList / ResultRow / BulkActionBar (表示)

modeMachine.ts (純粋)           ── ShortcutContext に selectionMode を追加し、
                                   行に紐づく操作の有効条件を選択モードで切り替える
```

**中心となる設計判断**: 「選択モードか」は UI の見た目だけの flag ではなく、**選択状態の一部**として `selectionModel` に持つ。理由は、決定事項4（修飾キー操作で自動的に選択モードへ入る）が「選択が発生したらモードも ON」という**不変条件**であり、これを Popup 側の呼び出し順に依存させると `toggle` を呼ぶ箇所すべてで `enterSelectionMode()` を並べる必要が生じ、1箇所忘れると「選択があるのに通常モード（＝クリックで開いてしまう）」という最悪の不整合が起きるため。純粋モデルに閉じ込めればユニットテストで固定できる。

## コンポーネント設計

### 1. `pages/popup/src/hooks/selectionModel.ts`（改訂）

**責務**:
- 選択集合 + anchor + **選択モードの ON/OFF** に対する純粋な状態遷移。

**変更内容**:

```ts
interface SelectionState {
  ids: ReadonlySet<string>;
  anchorId: string | null;
  /** 選択モード（行クリック＝選択）か。ids.size > 0 なら必ず true（不変条件）。 */
  active: boolean;
}

const emptySelection: SelectionState = { ids: new Set(), anchorId: null, active: false };

// 追加
const activate   = (s) => s.active ? s : { ...s, active: true };
const deactivate = () => emptySelection;              // 終了＝選択も捨てる（1箇所で保証）
const toggleActive = (s) => s.active ? deactivate() : activate(s);

// 改訂（いずれも active: true を伴う）
const toggle    = (s, id)               => ({ ...次の ids/anchor, active: true });
const rangeTo   = (s, targetId, order)  => ({ ...次の ids/anchor, active: true });
const selectAll = (order)               => ({ ids: new Set(order), anchorId: null, active: true });

// 既存のまま（ids/anchor のみクリアし active は保つ）
const clear = (s) => ({ ids: new Set(), anchorId: null, active: s.active });
```

**実装の要点**:
- `clear` と `deactivate` の違い（モードを保つ / 捨てる）を doc コメントで明示する。前者はクエリ / スコープ変更用、後者は終了導線用。
- `selectAll` は現行が `orderedIds` のみを引数に取る形（前状態非依存）。`active` を立てるだけなので引数は変えない。
- `toggle` で最後の1件を外して 0 件になった場合も `active` は **true のまま**（モードから勝手に抜けない。抜けると次のクリックが「開く」に化ける）。不変条件は「ids>0 ⇒ active」であって逆は要求しない。

### 2. `pages/popup/src/hooks/useSelection.ts`（改訂）

**責務**: 上記モデルを React state に載せ、安定参照のコールバックで公開する。

**API 追加**:

```ts
interface UseSelectionApi {
  selectedIds; count; isSelected; toggle; rangeTo; selectAll; clear;   // 既存
  /** 選択モード中か（行クリック＝選択）。 */
  selectionMode: boolean;
  /** 選択モードを終了する（選択もクリアする）。 */
  exitSelectionMode: () => void;
  /** ヘッダーのトグルボタン用。ON→OFF は選択もクリアする。 */
  toggleSelectionMode: () => void;
}
```

**実装の要点**:
- `enterSelectionMode` は公開しない。外から「入る」必要があるのはトグルボタンだけで、それは `toggleSelectionMode` が担う。選択操作経由の遷移はモデル内で起きる。API を最小に保ち、呼び出し側が「入ってから選ぶ」順序を書ける余地を無くす。
- 既存フックと同じく `useCallback` で安定参照にする（Popup の `useEffect` 依存配列に入るため）。

### 3. `pages/popup/src/hooks/modeMachine.ts`（改訂）

**責務**: キー意味論とショートカットの有効条件（純粋）。

**変更内容**:

```ts
interface ShortcutContext {
  mode; listFocus; selectionCount; resultCount;
  /** 選択モード中か（行の編集導線を止め、行操作を選択件数に依存させる）。 */
  selectionMode: boolean;
}
```

`isShortcutEnabled` の分岐:

| intent | 通常モード（従来どおり） | 選択モード中 |
|---|---|---|
| `inline-edit` / `alias-edit` | `hasFocusedRow` | **常に false** |
| `panel`（Ctrl/Cmd+M） | `hasFocusedRow`（単一） | `selectionCount > 0 && resultCount > 0` |
| `delete` | 検索欄以外 かつ `hasFocusedRow`（単一） | `selectionCount > 0`（検索欄では従来どおり無効） |
| `select-all` / `undo` / `add-current` | 変更なし | 変更なし |

**実装の要点**:
- 既存の `ctx.selectionCount > 0 ? 一括 : 単一` という書き方は、`selectionMode` の導入で「選択モード中の 0 件」という第3の状態が増える。分岐を素直に3値で書き、テストで固定する。
- `resolveKeyIntent`（`list:open` 等）のシグネチャは**変更しない**。`Enter` の意味は「フォーカス行を活性化」のままで、活性化が「開く」か「選択トグル」かは Popup が選択モードを見て決める（キーの意味論とアプリ状態の解釈を分ける）。

### 4. `pages/popup/src/components/SearchHeader.tsx`（改訂）

**責務**: 検索ボックス + スコープチップ + **選択モード切替** + ＋追加。

```
┌──────────────────────────────────────────────┐
│ [🔍 〔📁 開発/chrome〕 docs▌]  [☑ 選択] [＋ 追加] │  h56
└──────────────────────────────────────────────┘
```

**props 追加**: `selectionMode?: boolean` / `onToggleSelectionMode?: () => void`

**実装の要点**:
- 高さは「＋追加」と同じ 34px、`rounded-md`、`gap-1.5`。OFF = `border-line-input bg-white text-ink-soft`、ON = `bg-accent text-white`（既存トークンのみを使い、新しい色は増やさない）。
- `aria-pressed={selectionMode}`・`title` は ON / OFF で出し分ける。
- ラベルは `t('commonSelect')`（= 「選択」/「Select」）。ツールチップ用に i18n キーを2つ追加する（後述）。

### 5. `pages/popup/src/components/ResultRow.tsx`（改訂・本単位の中心）

**責務**: 1行の表示と押下の解釈。

**変更内容**:
- props: `checked` は維持。`selectionActive` を **`selectionMode`** に改名（意味が「1件以上選択中」から「選択モード中」に変わるため、名前を据え置くと読み手を誤らせる）。`onToggleSelect` / `onRangeSelect` は維持。
- `handleClick` の分岐を、**選択モードを最優先の早期分岐**にする:

```
handleClick(e):
  if (selectionMode) {                 // ← 行内に境界を作らない。押下対象は行そのもの
    e.shiftKey ? onRangeSelect() : onToggleSelect();
    return;
  }
  if (delete アイコン)  → onDelete()
  if (編集アイコン)     → onEnterInlineEdit()
  if (e.shiftKey)      → onRangeSelect()   // 通常モードからの自動遷移（決定事項4）
  if (e.metaKey||ctrl) → onToggleSelect()  // 同上
  if (別名エリア)       → onEnterAliasEdit()
  onOpen()
```

- `data-checkbox-area` の分岐と、ホバーでチェックボックスを出す `group-hover` 表示を**削除**する。
- チェックボックスは `selectionMode` のときだけ描画し、`pointer-events-none` を常時付ける（表示専用。押下は行が受ける）。ファビコンは `selectionMode` のとき描画しない（同寸の 16px 枠は維持しレイアウトを動かさない）。
- `onDoubleClick` は `selectionMode` のとき渡さない（インライン編集に入らない）。
- ✎ / 🗑 アイコンの `<span>` は `selectionMode` のとき描画しない。
- `handleMouseDown`（ドラッグ開始判定）の除外セレクタから `[data-checkbox-area]` を落とす。選択モード中は編集アイコン・別名エリアも無いため、実質「行本体のみ」という現行の意図がそのまま保たれる。

### 6. `pages/popup/src/components/ResultList.tsx`（改訂）

`selectionActive` → `selectionMode` の名称変更を透過するだけ（各行へ流す）。ロジック変更なし。

### 7. `pages/popup/src/components/BulkActionBar.tsx`（コメントのみ改訂）

`onClear` の意味が「選択解除」から「**選択解除 + 選択モード終了**」に変わる。UI・props は不変で、Popup 側の配線（`exitSelectionMode` を渡す）で実現する。doc コメントを更新する。

### 8. `pages/popup/src/Popup.tsx`（結線）

| 箇所 | 変更 |
|---|---|
| `useSelection()` 分解 | `selectionMode` / `exitSelectionMode` / `toggleSelectionMode` を受け取る |
| クエリ / スコープ変更 effect | 現行の `clearSelection()` のまま（モデル側で `active` を保つ＝AC-10） |
| `handleBulkDelete` / `handleBulkMoveConfirm` / D&D の一括移動 | 完了後に `clearSelection()` → **`exitSelectionMode()`** に置換（AC-6） |
| `Escape` の前段 | `selectionCount > 0` 条件 → **`selectionMode`** 条件にし、`clearSelection()` → `exitSelectionMode()`（AC-8） |
| ショートカット文脈 | `isShortcutEnabled(..., { …, selectionMode })` |
| `list:open` の実行 | `selectionMode ? handleToggleSelect(selectedIndex) : openAt(selectedIndex)`（AC-3） |
| ヘッダー | `selectionCount > 0 ? <BulkActionBar onClear={exitSelectionMode}/> : <SearchHeader selectionMode onToggleSelectionMode/>` |
| `ResultList` | `selectionActive={selectionCount>0}` → `selectionMode={selectionMode}` |

**`list:open` を Popup 側で分岐する理由**: `resolveKeyIntent` は「キー → 意図」の純粋写像であり、アプリ状態（選択モード）を引数に足すと LIST 以外の全モードにも無関係な引数が伝播する。意図（`list:open` = フォーカス行の活性化）の**解釈**は状態を持つ層＝ Popup の責務とし、マウスの `handleClick`（`ResultRow`）と対称にする。

### 9. i18n（`packages/i18n/locales/{ja,en}/messages.json`）

追加キー（`popup` 接頭辞・既存の並び順に従って `popupAddCurrent*` の近傍へ）:

| キー | ja | en |
|---|---|---|
| `popupSelectionModeEnter` | 選択モードに切り替え（アイテムを押して選ぶ） | Switch to selection mode (click items to select) |
| `popupSelectionModeExit` | 選択モードを終了（アイテムを押すと開く） | Exit selection mode (click items to open) |

ラベル自体は既存の `commonSelect`（選択 / Select）を流用する。

## データフロー

### UC-A: ボタンから入って一括移動する
```
1. ヘッダー [☑ 選択] クリック → toggleSelectionMode() → state.active = true
2. ヘッダーは SearchHeader のまま（ボタン ON 表示）。全行がチェックボックス表示に変わる
3. 行をクリック → ResultRow.handleClick が selectionMode 分岐 → onToggleSelect → toggle(ids)
4. count > 0 → ヘッダーが BulkActionBar に差し替わる
5. [移動] → openBulkMovePanel() → MovePanel（PANEL モード）
6. 確定 → moveRows(selectedItems, …)（1アンドゥ単位）→ exitSelectionMode() → 通常モードへ復帰
```

### UC-B: 通常モードから修飾キーで入る
```
1. 通常モードで Ctrl+クリック → ResultRow が onToggleSelect（開かない）
2. selectionModel.toggle が active: true を立てる ⇒ 同一レンダーで選択モードへ
3. 以降は UC-A の 4. 以降と同じ
```

### UC-C: 選択モード中に検索し直す
```
1. 選択モード（0件）→ SearchHeader のまま。検索ボックスへ入力できる
2. query 変更 → 既存 effect が clearSelection() → ids のみ空、active は true のまま
3. 新しい結果に対して選び直せる（モードから追い出されない）
```

## エラーハンドリング戦略

新規のエラー経路は無い。一括操作（`moveRows` / `deleteRows`）の失敗時のエラートーストは U13 の実装をそのまま使う。

**ただし1点**: 一括操作の失敗時も `exitSelectionMode()` は実行する（現行の `clearSelection()` と同じタイミング＝ `void` 実行の直後）。失敗して結果が変わらなかった場合に選択が消える点は現行の挙動と同じであり、本単位で挙動を変えない（変えるなら U13 側の設計変更として別単位で扱う）。

## テスト戦略

### ユニットテスト（追加・改訂）

`pages/popup/src/hooks/selectionModel.test.ts`:
- `emptySelection.active === false`
- `toggle` / `rangeTo` / `selectAll` はいずれも `active: true` を返す（決定事項4の不変条件）
- `toggle` で最後の1件を外しても `active` は true のまま
- `clear` は ids/anchor を空にし `active` を保つ
- `deactivate` は ids/anchor/active をすべて初期化する
- `toggleActive` は OFF→ON（ids 保持）/ ON→OFF（ids 破棄）
- 不変条件のプロパティ的確認: 任意の操作後 `ids.size > 0 ⇒ active === true`

`pages/popup/src/hooks/modeMachine.test.ts`:
- `selectionMode: true` で `inline-edit` / `alias-edit` が false
- `selectionMode: true` かつ `selectionCount === 0` で `delete` / `panel` が false
- `selectionMode: true` かつ `selectionCount > 0` で `delete` / `panel` が true（左ペイン `FOLDER_TREE` でも true）
- `selectionMode: false` の全ケースが従来どおり（既存テストを退行させない）

### 手動確認（受け入れ時）

- 通常モードで行の端・ファビコン・別名チップ横をクリック → 常に開く / チェックボックスが出ない
- 選択モードで行のどこを押しても選択が切り替わり、サイトが開かない
- 一括削除 → アンドゥ1回で全戻し・通常モードへ復帰
- `Escape` / ボタン再押下 / [選択解除] の3経路すべてで通常モードへ戻る

## 依存ライブラリ

追加なし。

## ディレクトリ構造

```
pages/popup/src/
├── hooks/
│   ├── selectionModel.ts        (改訂: active を追加)
│   ├── selectionModel.test.ts   (改訂: active の遷移テスト)
│   ├── useSelection.ts          (改訂: selectionMode / exit / toggle を公開)
│   ├── modeMachine.ts           (改訂: ShortcutContext.selectionMode)
│   └── modeMachine.test.ts      (改訂: 選択モード分岐のテスト)
├── components/
│   ├── SearchHeader.tsx         (改訂: [☑ 選択] トグルボタン)
│   ├── ResultRow.tsx            (改訂: 左チェック廃止・選択モード優先分岐)
│   ├── ResultList.tsx           (改訂: selectionActive → selectionMode)
│   └── BulkActionBar.tsx        (改訂: onClear の意味をコメント更新)
└── Popup.tsx                    (改訂: 結線一式)

packages/i18n/locales/{ja,en}/messages.json  (改訂: ツールチップ2キー追加)

docs/
├── functional-design.md         (改訂: 「チェックボックスの段階表示」表・設計判断表)
└── design/README.md             (改訂: 1f の表示条件・操作一覧)
```

## 実装の順序

1. 純粋モデル（`selectionModel` → `modeMachine`）とそのテスト
2. フック（`useSelection`）
3. i18n キー追加
4. UI（`SearchHeader` → `ResultRow` → `ResultList` → `BulkActionBar`）
5. 結線（`Popup.tsx`）
6. 品質ゲート（test / lint / type-check）
7. 永続ドキュメント更新

## セキュリティ考慮事項

権限・データフローの変更なし（`chrome.bookmarks` の呼び出し経路は不変）。

## パフォーマンス考慮事項

- `selectionMode` は真偽値1つで、仮想スクロールの行数に比例するコストは増えない。
- 通常モードではチェックボックスの DOM を**描画しない**ため、現行（全行に非表示のチェックボックスを重ねている）より可視行あたりの要素数がわずかに減る。

## 将来の拡張性

- 選択モードの状態を `PopupSession`（U19）へ保存する拡張は容易（`selectionModel` の `active` を写すだけ）。ただし本単位では**保存しない**（開くたび通常モードから始めるほうが誤操作が少ない）。
- 一括操作の追加（例: 一括で別名を付与）は `BulkActionBar` へボタンを増やすだけで、選択モードの仕組みには影響しない。
