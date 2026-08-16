# 設計書 — alias-editor-close

## アーキテクチャ概要

既存の3層（純粋モデル → コンポーネント → Popup の結線）と「キー/ポインタの横断的な処理は Popup の document リスナーへ集約する」という規律をそのまま使う。

```
aliasEditorModel.ts (純粋)      ── どこを押したときに「閉じる」「クリックを飲む」かを解決する
        │
Popup.tsx (結線)                 ── document の click キャプチャで判定し、実行を AliasEditor へ委譲
        │
AliasEditor.tsx                  ── 命令ハンドル（commitPendingAndClose）を公開・[完了] ボタンを追加
        │
PopupShell.tsx                   ── 右ペインかどうかを DOM から判定できるよう目印を付ける
```

**中心となる設計判断1: 判定を純粋関数へ、実行を命令ハンドルへ**

外側クリックの扱いは3通りに分岐する（何もしない / 閉じるだけ / 閉じてクリックも飲む）。この分岐を `Popup.tsx` のリスナー内に `if` で書くとテストが当たらないため、**判定だけを純粋関数 `resolveOutsideClick` に切り出す**（`modeMachine.isShortcutEnabled`・`rowMenuModel.canOpenRowMenu` と同じ考え方）。DOM から取り出した2つの真偽値（編集行の内側か / 右ペインの内側か）を渡し、結果の列挙型を受け取る。

一方、「入力途中の文字を確定してから閉じる」は `AliasEditor` の内部 state（`input`）を要する。Popup からは触れないため、**`actionsRef`（命令ハンドル）で `commitPendingAndClose()` を公開**する。`MovePanel` / `ContextMenu` / `FolderTree` と同じ既存パターンであり、新しい仕組みではない。

**中心となる設計判断2: `click` のキャプチャフェーズ1本で処理する**

「クリックを飲む」には、行の `onClick`（React が root で listen）より先に止める必要がある。`document` の**キャプチャフェーズ**で `click` を捕まえ、`stopPropagation()` すれば React へ届かない。

`mousedown` ではなく `click` を使う理由: `mousedown` で `stopPropagation()` しても後続の `click` は別途発火するため、飲むには両方を扱う必要があり、フラグを跨いだ状態管理が要る。`click` 1本なら状態を持たずに完結する。閉じるタイミングが `mousedown` より一瞬遅れるが、体感差は無い。

## コンポーネント設計

### 1. `pages/popup/src/components/aliasEditorModel.ts`（拡張・純粋）

```ts
/**
 * 別名編集中に発生したポインタ押下の扱い。
 * - `ignore`: 編集の内側 → 何もしない（従来の編集操作）
 * - `close`: 閉じるだけ（クリック先の操作はそのまま実行される＝左ペイン・ヘッダー）
 * - `close-and-swallow`: 閉じたうえでクリック自体を無効化する（＝右ペイン）
 */
type OutsideClickAction = 'ignore' | 'close' | 'close-and-swallow';

interface OutsideClickContext {
  /** 押下位置が編集中の行（AliasEditor を含む行）の内側か。 */
  insideEditor: boolean;
  /** 押下位置が右ペイン（結果リスト側）の内側か。 */
  inResultPane: boolean;
}

const resolveOutsideClick = (ctx: OutsideClickContext): OutsideClickAction =>
  ctx.insideEditor ? 'ignore' : ctx.inResultPane ? 'close-and-swallow' : 'close';
```

**実装の要点**:
- 判定材料は DOM 由来の真偽値のみ。`Element` や `MouseEvent` を受け取らない（jsdom 無しでテストできる形にする）。
- `insideEditor` を先に見る。編集行は右ペインの内側にあるため、順序を逆にすると編集内のクリックまで飲んでしまう。

### 2. `pages/popup/src/components/AliasEditor.tsx`（改訂）

**props 追加**:
```ts
/** Popup の document リスナーから閉じる操作を呼ぶための命令ハンドル。 */
actionsRef?: RefObject<AliasEditorActions | null>;

interface AliasEditorActions {
  /** 入力途中の文字を別名として確定してから閉じる（外側クリック・[完了] の共通経路）。 */
  commitPendingAndClose: () => void;
}
```

**実装の要点**:
- `commitPendingAndClose` は `handleCommit()` 相当を通してから `onClose()` を呼ぶ。`commitAlias` の結果が `duplicate` / `at-limit` / `too-long` でも**閉じる**（外側を押した意思を優先する。上限超過で閉じられないと出口を失う）。
- `handleCommit` は `persist`（楽観更新 + 永続化）を通るため、保存経路は既存と同一。新しい保存ロジックは作らない。
- `useEffect` で `actionsRef.current` を最新の closure に差し替える（既存3コンポーネントと同じ書き方）。
- **[完了] ボタン**: ヒント行の右端（`N / 20` の隣）に置く。押下は `commitPendingAndClose`。`onMouseDown={e => e.preventDefault()}` を付け、入力欄からフォーカスを奪ってチップ確定前に blur が走るのを避ける。
- 編集行のルート（`ResultRow` の別名編集分岐の `<div>`）に **`data-alias-editing="true"`** を付ける（`insideEditor` 判定用）。`AliasEditor` 自身ではなく行のラッパに付けるのは、ヒント行や1段目（タイトル）も「編集の内側」として扱うため。

### 3. `pages/popup/src/components/ResultRow.tsx`（改訂）

**(a) 編集行の目印**: 別名編集中の分岐（`if (editingAlias)`）で返す `<div>` に `data-alias-editing="true"` を付ける。

**(b) 他の行のカーソル（決定事項5）**: props に `aliasEditingElsewhere?: boolean` を追加し、true のとき行の `<button>` へ **`cursor-default`** を当てる。

- **なぜ明示指定が必要か**: Tailwind v3 の preflight が `button, [role="button"] { cursor: pointer }` を当てているため、結果行（`<button>`）は放っておくと必ず指カーソルになる。`cursor-default` ユーティリティは preflight より後に出力されるため上書きできる。
- **なぜ既存の `dimmed` を流用しないか**: `dimmed` は「別名編集**または**インライン編集で他行が薄暗い」という広い条件。インライン編集中の他行はクリックすると実際にブックマークが開くため、そこまでカーソルを変えると**逆方向の不一致**（押せるのに押せなく見える）を作る。別名編集に限定した専用の prop を持たせる。
- ホバー背景（`hover:bg-pane-3`）は現状維持。対象行は既に `opacity-40` で薄暗く、押下可能性の主要な手掛かりはカーソル形状であるため、変更を最小に留める。

### 3b. `pages/popup/src/components/ResultList.tsx`（改訂）

- `aliasEditorActionsRef` を**編集中の行にだけ**渡す。
- 各行へ `aliasEditingElsewhere={editingAliasId !== null && !isEditingThisAlias}` を渡す（判定材料は既にローカル変数として存在する）。

### 4. `pages/popup/src/components/PopupShell.tsx`（改訂）

右ペインの `<main>` に **`data-pane="result"`** を付ける（`inResultPane` 判定用）。レイアウトは変えない。

左ペイン（`<aside>`）にも対称性のため `data-pane="folder"` を付けるが、判定には使わない（「右ペインでなければ左ペイン扱い」ではなく、ヘッダーやオーバーレイも含めて `close` に倒すため）。

### 5. `pages/popup/src/Popup.tsx`（結線）

**document のキャプチャリスナーを1つ追加**（既存の `keydown` / `contextmenu` リスナーと同じ場所・同じ規律）:

```
useEffect(() => {
  if (mode.mode !== 'ALIAS_EDIT') return;          // 別名編集中のみ動作
  const onClickCapture = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const action = resolveOutsideClick({
      insideEditor: Boolean(target?.closest('[data-alias-editing]')),
      inResultPane: Boolean(target?.closest('[data-pane="result"]')),
    });
    if (action === 'ignore') return;
    if (action === 'close-and-swallow') {
      e.preventDefault();
      e.stopPropagation();
    }
    aliasEditorActionsRef.current?.commitPendingAndClose() ?? closeAliasEdit();
  };
  document.addEventListener('click', onClickCapture, true);   // capture
  return () => document.removeEventListener('click', onClickCapture, true);
}, [mode.mode, closeAliasEdit]);
```

- **`mode.mode !== 'ALIAS_EDIT'` で早期 return**。リスナーの登録自体を別名編集中に限定し、他モードへの影響をゼロにする（AC-10）。
- 命令ハンドルが未接続の場合（理論上のみ）は `closeAliasEdit()` へフォールバックし、「閉じられない」状態を作らない。
- `closeAliasEdit` は既存のまま（`focusSearch()` を呼び、`ALIAS_EDIT` を抜けて検索ボックスへ戻す）。

**`AliasEditor` への `actionsRef` 受け渡し**: `Popup` → `ResultList` → `ResultRow` → `AliasEditor` と props で流す。`ResultList`/`ResultRow` は編集中の行にだけ渡す（他の行は `undefined`）。

## データフロー

### UC-A: 入力途中で右ペインの他の行を押す
```
1. 「こうし」と入力した状態で、別の結果行をクリック
2. document の click キャプチャが発火
   insideEditor=false / inResultPane=true → 'close-and-swallow'
3. preventDefault + stopPropagation（行の onClick は発火しない＝ブックマークは開かない）
4. aliasEditorActionsRef.commitPendingAndClose()
   → handleCommit()（'こうし' を追加・persist で保存）→ onClose() → closeAliasEdit()
5. LIST へ戻り検索ボックスへフォーカス。もう一度その行を押せば通常どおり開く
```

### UC-B: 左ペインのフォルダを押す
```
1. 別名編集中に左ペインの「開発」をクリック
2. click キャプチャ: insideEditor=false / inResultPane=false → 'close'
3. イベントは止めない → FolderTree の onClick が通常どおり走りスコープが「開発」へ変わる
4. あわせて commitPendingAndClose() で入力を確定して閉じる
```

### UC-C: [完了] を押す
```
1. [完了] をクリック（編集行の内側なので click キャプチャは 'ignore'）
2. ボタン自身の onClick → commitPendingAndClose() → 確定 → onClose()
```

## エラーハンドリング戦略

新しいエラー経路は無い。別名の保存失敗時は既存の `persist` が担う（楽観更新 → 失敗でロールバック + ログ）。`commitPendingAndClose` は保存の完了を待たずに閉じる（既存の `handleCommit` と同じく fire-and-forget）。閉じた後にロールバックが起きても、次回の索引再構築で整合する。

## テスト戦略

### ユニットテスト（追加）

`pages/popup/src/components/aliasEditorModel.test.ts`（既存ファイルに追加）:
- `resolveOutsideClick`: 編集の内側 → `ignore`
- 右ペインの外側 → `close-and-swallow`
- 左ペイン・ヘッダー（どちらでもない） → `close`
- **編集の内側かつ右ペインの内側 → `ignore`**（編集行は右ペイン内にあるため、この順序が崩れると編集内のクリックを飲んでしまう）

### 既存テストへの影響

`commitAlias` / `removeAt` / `removeLast` / `orderMatchedFirst` は変更しないため既存14テストはそのまま通る。

### 手動確認（受け入れ時）

- 入力途中で他の行を押す → 別名が保存され、**サイトは開かない**。もう一度押すと開く
- 左ペインのフォルダを押す → スコープが変わり、編集も閉じる（1クリック）
- 検索ボックスを押す → 閉じてそのまま入力できる
- チップ・`✕`・入力欄・ヒント行を押しても閉じない
- **別名編集中、他の行にカーソルを乗せても指カーソルにならない**（左ペイン・ヘッダーは指カーソルのまま）
- `Escape` では入力途中の文字が保存されない
- [完了] で閉じる

## 依存ライブラリ

追加なし。

## ディレクトリ構造

```
pages/popup/src/
├── components/
│   ├── aliasEditorModel.ts       (拡張: resolveOutsideClick)
│   ├── aliasEditorModel.test.ts  (拡張: 判定4ケース)
│   ├── AliasEditor.tsx           (改訂: actionsRef / [完了] ボタン)
│   ├── ResultRow.tsx             (改訂: data-alias-editing / 他行の cursor-default)
│   ├── ResultList.tsx            (改訂: actionsRef の中継 / aliasEditingElsewhere)
│   └── PopupShell.tsx            (改訂: data-pane)
└── Popup.tsx                     (改訂: click キャプチャリスナー・actionsRef)

packages/i18n/locales/{ja,en}/messages.json  (1キー追加: 完了ボタン)
docs/design/README.md                         (1e の操作・操作一覧を改訂)
docs/functional-design.md                     (UC-2 の終了導線を追記)
```

## 実装の順序

1. 純粋モデル（`resolveOutsideClick`）+ テスト
2. i18n（[完了]）
3. `AliasEditor`（命令ハンドル + [完了] ボタン）
4. DOM の目印（`ResultRow` の `data-alias-editing` / `PopupShell` の `data-pane`）と他行のカーソル
5. `ResultList` の中継 → `Popup` の結線（click キャプチャ）
6. 品質ゲート
7. 永続ドキュメント更新

## セキュリティ考慮事項

権限・データフローの変更なし。

## パフォーマンス考慮事項

- document のリスナーは**別名編集中のみ登録**する（`mode.mode !== 'ALIAS_EDIT'` で早期 return）。通常時のクリックに一切のコストを足さない。
- 判定は `closest()` 2回のみ。1クリックあたりの処理として無視できる。

## 将来の拡張性

- `resolveOutsideClick` は「編集の内側か / 右ペインの内側か」という抽象で書かれており、インライン編集（状態1d）へ同じルールを広げたくなった場合もそのまま使える（本単位ではスコープ外）。
- **申し送り（継続）**: PANEL 用途の共存フラグ（`bulkMovePanel` / `addCurrentPanelOpen` / `contextAction`）の `panelKind` ユニオンへの統合は引き続き未実施。本単位は `ALIAS_EDIT` モードのみを扱うため影響しない。
