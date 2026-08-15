# 設計: shortcut-mode-parity（ショートカットの有効モード整合）

- **作業単位名**: `shortcut-mode-parity`
- **作成日**: 2026-08-15
- **前提**: [requirements.md](./requirements.md)

---

## 1. 方針

**「ショートカットが今有効か」の判定を `modeMachine.ts` の純粋関数 `isShortcutEnabled` に一元化し、
`Popup.tsx` は『インテント一致 → 有効判定 → 実行』の3段だけを書く形にする。**

現状、有効条件は `Popup.tsx` の `useEffect` 内に7通り直書きされており、しかも
`if (currentMode === 'LIST') { ... }` というブロック構造そのものが暗黙の条件になっている。
**この「ブロックに入れる場所を間違えると静かに無効化される」構造が、前単位で3ラウンドの手戻りを生んだ真因**。
条件をデータ（純粋関数）に移せば、ブロック構造への依存が消え、マトリクスを単体テストで固定できる。

```
KeyboardEvent
   │
   ▼
resolveShortcutIntent(e)                     ← modeMachine.ts（変更なし）
   │  'delete' / 'select-all' / 'panel' / ...
   ▼
isShortcutEnabled(intent, ctx)               ← ★新規: modeMachine.ts（純粋・テスト対象）
   │  ctx = { mode, listFocus, selectionCount, resultCount }
   ▼
Popup.tsx が実行（enterPanel / handleBulkDelete / selectAllRows ...）
```

---

## 2. コンポーネント設計

### 2.1 `modeMachine.ts` に追加する純粋関数

**責務**: 「このショートカットは、いまのモード・フォーカス位置・選択件数・結果件数で有効か」を返す。副作用なし。

```ts
/** `isShortcutEnabled` の判定文脈。React 側の state をそのまま写した値オブジェクト。 */
interface ShortcutContext {
  mode: Mode;
  /** LIST モード内のフォーカス位置。LIST 以外では参照されない。 */
  listFocus: ListFocus;
  /** チェック選択の件数（0 なら単一行が対象）。 */
  selectionCount: number;
  /** 現在の表示結果の件数。 */
  resultCount: number;
}

/**
 * 検索ボックスにキャレットがあるか。ここではネイティブのテキスト操作
 * （前方削除・テキスト全選択）を奪わない。
 */
const isCaretInSearch = (ctx: ShortcutContext): boolean =>
  ctx.mode === 'LIST' && ctx.listFocus === 'search';

/** 右ペインの「フォーカス中の行」を対象にできるか（＝行に紐づく操作の前提）。 */
const hasFocusedRow = (ctx: ShortcutContext): boolean =>
  ctx.mode === 'LIST' && ctx.resultCount > 0;

const isShortcutEnabled = (intent: ShortcutIntent, ctx: ShortcutContext): boolean => {
  // 自前の文字入力 UI を持つモードでは一切横取りしない（既存の規律を最上位に置く）。
  if (isSearchFirstExempt(ctx.mode)) return false;

  switch (intent) {
    // ── 行に紐づく操作（対象＝右ペインでフォーカス中の行） ──
    case 'inline-edit':
    case 'alias-edit':
      return hasFocusedRow(ctx);

    // ── 対象が状況で変わる操作 ──
    case 'panel':
      // 選択あり = 一括移動（対象はチェック選択）→ 左ペインでも可。
      // 選択なし = 単一移動（対象はフォーカス中の行）→ LIST のみ。
      return ctx.selectionCount > 0 ? ctx.resultCount > 0 : hasFocusedRow(ctx);
    case 'delete':
      // 検索ボックスでは常にネイティブの前方削除を優先する。
      if (isCaretInSearch(ctx)) return false;
      // 選択あり = 一括削除 → 左ペインでも可。選択なし = 単一削除 → LIST のみ。
      return ctx.selectionCount > 0 ? ctx.resultCount > 0 : hasFocusedRow(ctx);

    // ── 行に紐づかない操作 ──
    case 'select-all':
      // 検索ボックスのネイティブなテキスト全選択を奪わない。それ以外は左ペインでも可。
      return !isCaretInSearch(ctx) && ctx.resultCount > 0;
    case 'undo':
    case 'add-current':
      // 対象がフォーカスにも結果件数にも依存しない。モード適合のみで判定する
      // （`undo` のトースト保持 = `undoPending` は外部状態のため呼び出し側が併せて見る）。
      return true;

    default:
      return false;
  }
};
```

**実装の要点**:

- **`isSearchFirstExempt` を先頭のガードに置く**ことで、「編集中は横取りしない」という既存の規律を
  全ショートカットに一括適用する。個別ケースで書き忘れる余地が無くなる。
- `mode === 'FOLDER_TREE'` を明示的に列挙しない。`isSearchFirstExempt` で `INLINE_EDIT`/`ALIAS_EDIT`/`PANEL`/`DRAG` を
  弾いた後に残るのは `LIST` と `FOLDER_TREE` だけなので、**「LIST 限定にしたいものだけ `hasFocusedRow` で絞る」**
  という書き方になる。これが「行に紐づくか否か」という判定基準をそのままコードに写した形。
- `switch` は全インテントを網羅させ、`default: return false` を防御的デフォルトとして置く
  （既存 `modeMachine` の他の `switch`（`modeReducer` / `resolveKeyIntent`）と同じ方針）。
  - ⚠️ **`never` 型によるコンパイル時の網羅性チェックは行わない**。`ShortcutIntent` に値を追加しても型エラーにはならず、
    `default` に落ちて「無効」として扱われる（実行時は安全側だが、定義漏れは静かに通る）。
    リポジトリ内の既存 `switch` がいずれも `never` を使っておらず、本単位だけ様式を変えると一貫性を欠くため。
    **網羅性チェックの導入は、`modeMachine` の全 `switch` をまとめて対象にする横断単位で扱う**（申し送りに記録）。
    なお定義漏れが起きても、`isShortcutEnabled` のテストが「新インテントのケースが無い」ことで気づく余地は残る。
- 既存 pure module の慣例に従い、宣言は非 export とし、ファイル末尾で export をまとめる
  （`isShortcutEnabled` と型 `ShortcutContext` を追加。`isCaretInSearch`/`hasFocusedRow` は内部ヘルパーのため非公開）。

### 2.2 `Popup.tsx` の変更

**責務変更なし**。条件式を `isShortcutEnabled` の呼び出しへ置き換える。

現在の構造（前単位までの結果）:

```
[共通ブロック]  undo / add-current / panel(選択あり)     ← isSearchFirstExempt で判定
if (currentMode === 'LIST') {
  [LIST ブランチ]  alias-edit / inline-edit / panel(選択なし) / delete / select-all
}
```

変更後は**すべてのショートカットを共通ブロックへ集約**し、`if (currentMode === 'LIST')` は
`resolveKey` によるキー意味論（`list:move-up` 等）の処理だけを担う形にする。

```ts
const shortcutIntent = resolveShortcutIntent(e);
const shortcutCtx = { mode: currentMode, listFocus, selectionCount, resultCount: results.length };
if (shortcutIntent !== null && isShortcutEnabled(shortcutIntent, shortcutCtx)) {
  switch (shortcutIntent) {
    case 'undo':
      // 保持が無ければネイティブの取り消しへ委ねる（外部状態のためここで判定する）。
      if (!undoPending) break;
      e.preventDefault(); undoLatest(); return;
    case 'add-current':
      e.preventDefault(); void handleOpenAddCurrent(); return;
    case 'panel':
      e.preventDefault();
      if (selectionCount > 0) openBulkMovePanel(); else enterPanel();
      return;
    case 'delete':
      e.preventDefault();
      if (selectionCount > 0) handleBulkDelete(); else handleDeleteAt(selectedIndex);
      return;
    case 'alias-edit':   e.preventDefault(); enterAliasEditAt(selectedIndex);  return;
    case 'inline-edit':  e.preventDefault(); enterInlineEditAt(selectedIndex); return;
    case 'select-all':   e.preventDefault(); selectAllRows(orderedIds);        return;
  }
}
```

**この形にする利点**:
- 「どのブロックに置くか」という**位置依存の判断が消える**（前単位の3件のバグはすべてこれが原因）。
- `undo` だけが `undoPending` という外部状態を見る例外であることが、`break` の1行で明示される。
- 実行部（何をするか）と有効条件（いつ効くか）が分離され、後者だけをテストできる。

**注意点**:
- `undo` の `break` は「有効だが保持なし」を意味し、`switch` を抜けて後続処理（`resolveKey` 等）へ流す。
  従来の「保持が無ければ何もせずネイティブの取り消しに委ねる」と同じ挙動（`Ctrl+Z` は `resolveKeyIntent` で
  `none` になるため実質そのまま素通し）。
- `handleOpenAddCurrent` / `openBulkMovePanel` の `exitToList()` 経由（前単位の修正）はそのまま維持する。

### 2.3 変更しないもの

- `resolveShortcutIntent`（キー → インテント）／ `SHORTCUTS` 定数 — キー割り当ては不変。
- `modeReducer` — 遷移規則は不変。到達性は呼び出し側の `exitToList(); enterXxx();` で担保する。
- `BulkActionBar` / `MovePanel` / `AddCurrentPanel` — UI 側の変更なし。

---

## 3. データフロー

### UC-1: FOLDER_TREE でチェック選択 → `Delete`（AC-1）

```
1. keydown(Delete) → mode='FOLDER_TREE', selectionCount=3, resultCount=20
2. resolveShortcutIntent → 'delete'
3. isShortcutEnabled('delete', ctx):
   a. isSearchFirstExempt('FOLDER_TREE') = false      → 続行
   b. isCaretInSearch = false（mode が LIST でない）  → 続行
   c. selectionCount > 0 → resultCount > 0 → true
4. e.preventDefault() → handleBulkDelete() → deleteRows(selectedItems) + clearSelection()
   （1アンドゥ単位・トースト表示）
```

### UC-2: FOLDER_TREE で選択なしの `Delete`（AC-2）

```
3. isShortcutEnabled: selectionCount === 0 → hasFocusedRow(mode='FOLDER_TREE') = false → false
4. 何もせず後続へ（ネイティブの既定動作。ツリー上では実質無害）
```

### UC-3: 検索ボックスにキャレットがある状態で `Ctrl/Cmd+A`（AC-3）

```
3. isShortcutEnabled('select-all'): isCaretInSearch = true → false
4. 素通し → ブラウザのネイティブなテキスト全選択が働く（既存挙動の維持）
```

---

## 4. エラーハンドリング戦略

新規のエラー経路は無い。`isShortcutEnabled` は全域関数で例外を投げず、未知のインテントは `false`
（＝何もしない）に倒す。これは `modeReducer` が不正遷移を現状維持に倒す既存方針と同じ考え方。

---

## 5. テスト戦略

### ユニットテスト: `pages/popup/src/hooks/modeMachine.test.ts`（既存ファイルに追加）

`describe('isShortcutEnabled')` を追加し、**モード × フォーカス位置 × 選択件数 × 結果件数**のマトリクスを固定する。

| # | ケース | 期待 | 対応 AC |
|---|---|---|---|
| 1 | `delete` / FOLDER_TREE / 選択3件 | `true` | AC-1 |
| 2 | `delete` / FOLDER_TREE / 選択0件 | `false` | AC-2 |
| 3 | `delete` / LIST+result / 選択0件 / 結果あり | `true` | AC-2 |
| 4 | `delete` / LIST+search / 選択3件 | `false`（前方削除を優先） | AC-2 |
| 5 | `delete` / LIST+result / 結果0件 | `false` | AC-4 |
| 6 | `select-all` / FOLDER_TREE / 結果あり | `true` | AC-3 |
| 7 | `select-all` / LIST+search | `false` | AC-3 |
| 8 | `select-all` / LIST+result | `true` | AC-3 |
| 9 | `select-all` / 結果0件 | `false` | AC-4 |
| 10 | `panel` / FOLDER_TREE / 選択あり（一括移動） | `true` | AC-4（前単位の修正の固定） |
| 11 | `panel` / FOLDER_TREE / 選択なし（単一移動） | `false` | AC-4 |
| 12 | `panel` / LIST / 選択なし / 結果あり | `true` | AC-4 |
| 13 | `add-current` / FOLDER_TREE | `true` | AC-4（前単位の修正の固定） |
| 14 | `add-current` / LIST+search / 結果0件 | `true`（対象を問わない） | AC-4 |
| 15 | `undo` / FOLDER_TREE | `true` | AC-4 |
| 16 | `inline-edit` / `alias-edit` / FOLDER_TREE | `false`（行に紐づく） | AC-4 |
| 17 | `inline-edit` / `alias-edit` / LIST / 結果あり | `true` | AC-4 |
| 18 | 全インテント × `INLINE_EDIT`/`ALIAS_EDIT`/`PANEL`/`DRAG` | すべて `false` | AC-4 |

> **AC-5「前単位の3件のバグをテストで検出できる」の担保**: #10・#13 が前単位で修正した2件（FOLDER_TREE での
> 一括移動・現在ページ登録）に対応し、#1・#6 が今回修正する2件に対応する。修正前の条件（LIST 限定）なら
> これらは `false` を返し、テストが落ちる。

### 手動確認（ゲート2 で提示）

- 実機で AC-1〜AC-4 を確認する。特に**回帰確認**（AC-4）を重点的に行う: 今回は7つすべての条件式を書き換えるため、
  影響範囲が前単位より広い。

---

## 6. ディレクトリ構造（変更対象）

```
pages/popup/src/
├── hooks/
│   ├── modeMachine.ts        # 変更: isShortcutEnabled / ShortcutContext を追加
│   ├── modeMachine.test.ts   # 変更: describe('isShortcutEnabled') を追加
│   └── ...
└── Popup.tsx                 # 変更: 7つの条件式を isShortcutEnabled へ統一

docs/
├── functional-design.md      # 変更: 操作分類の表に Delete(一括) / Ctrl+A を反映
└── product-requirements.md   # 変更: 「起動直後のフォーカス位置」の是正
```

---

## 7. 実装の順序

1. `modeMachine.ts` に `ShortcutContext` / `isShortcutEnabled` を追加
2. `modeMachine.test.ts` にマトリクステストを追加し、単体で緑にする
3. `Popup.tsx` の7箇所を `isShortcutEnabled` ベースへ統一（共通ブロックへ集約）
4. ドキュメント整合
5. `implementation-validator` → 品質ゲート（フォアグラウンドで exit code 確認）

## 8. 依存ライブラリ

追加なし。

## 9. セキュリティ考慮事項

該当なし（純粋な条件判定であり、外部入力・権限・ストレージに触れない）。

## 10. パフォーマンス考慮事項

`isShortcutEnabled` は O(1) の分岐のみ。keydown 1回につき最大1回の呼び出しで、従来の直書き条件と同等。

## 11. 将来の拡張性

- 「モード分岐のどこに置くか」を考える必要が無くなるため、**本単位で修正したのと同種のバグが構造的に発生しなくなる**。
  ショートカットを追加するときは `isShortcutEnabled` の `switch` に1ケース足すだけでよく、
  有効条件がテストで固定される（ただし上記のとおり、定義漏れをコンパイル時に検出はしない）。
- 将来 `FOLDER_TREE` 固有のショートカット（例: フォルダのリネーム）を足す場合も、
  `hasFocusedRow` と対になる `hasFocusedFolder` を追加する形で同じパターンに乗せられる。
