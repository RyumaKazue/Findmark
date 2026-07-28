# 設計書 — U10 inline-edit-delete-undo

## アーキテクチャ概要

architecture.md のレイヤー依存「UI → サービス → データ」を維持する。新規の**アンドゥ管理はサービスレイヤー**（`packages/shared/lib/undo/`）に純粋クラスとして置き、UI（popup）は React フック経由で購読する。破壊的操作の実行そのものは既存のデータレイヤー（`BookmarkService` / `AliasStore`）に閉じ、UI は `chrome.*` を一切触らない。

```
┌─ pages/popup (UI) ───────────────────────────────────────────────┐
│ Popup.tsx                                                        │
│  ├ useRowActions()  ← 編集/削除のオーケストレーション（新規）      │
│  │    ├ commitEdit / deleteRow                                   │
│  │    └ 失敗時ロールバック + エラー通知                            │
│  ├ useUndo()        ← UndoManager の React バインディング（新規）  │
│  ├ useSearch()      ← refresh() を追加（索引変更後の再検索）       │
│  ├ InlineEdit.tsx   ← 状態1d フォーム（新規）                     │
│  │    └ inlineEditModel.ts（純粋: URL検証・確定判定）             │
│  └ Toast.tsx        ← アンドゥ/エラートースト（新規）              │
└──────────────────────┬───────────────────────────────────────────┘
                       │ 依存（一方向）
┌─ packages/shared (サービス) ─────────────────────────────────────┐
│ undo/UndoManager.ts    ← 1件保持・5秒期限・subscribe（新規）       │
│ search/SearchEngine.ts ← updateNode / removeNode / addNode（追加）│
└──────────────────────┬───────────────────────────────────────────┘
                       │ 依存（一方向）
┌─ packages/storage (データ) ──────────────────────────────────────┐
│ bookmarkService.ts  rename / updateUrl / remove /                │
│                     ensureFolderPath / create（既存・変更なし）   │
│ aliasStore.ts       remove / upsert（既存・変更なし）             │
└──────────────────────────────────────────────────────────────────┘
```

**データレイヤーは変更しない**（U4/U5 で必要な API が揃っている）ことが本単位の設計上の要点。

## コンポーネント設計

### 1. `UndoManager`（`packages/shared/lib/undo/UndoManager.ts`・新規）

**責務**:
- 直近1件のアンドゥ可能アクションを、期限（5秒）付きでメモリ保持する。
- 期限内の `undoLatest()` でアクションを1回だけ実行し、保持を解除する。
- 保持状態の変化を購読者（UI）へ通知する。

**インターフェース**（functional-design「UndoManager(即時アンドゥ)」の契約を維持）:

```typescript
interface UndoableAction {
  label: string;              // トースト文言（例:「◯◯」を削除しました）
  undo(): Promise<void>;
  expiresAt: number;          // now + UNDO_WINDOW_MS
}

class UndoManager {
  register(action: UndoableAction): void;      // 直前のアクションを置き換える
  undoLatest(): Promise<void>;                 // 期限切れ/未登録なら何もしない
  peek(): UndoableAction | null;
  subscribe(listener: (action: UndoableAction | null) => void): () => void;
  dismiss(): void;                             // トーストを閉じる＝アンドゥ機会の放棄
}

const UNDO_WINDOW_MS = 5000;
```

**実装の要点**:
- **保持は1件のみ**。functional-design の「1単位のアクション」という定義に従い、多段アンドゥは持たない（U13 の一括操作も「1アンドゥ単位」として1件に収まる）。
- 期限管理は `setTimeout(expiresAt - Date.now())` による自動破棄 + `undoLatest()` 時の `Date.now()` 再チェックの**二重**で行う。タイマーだけに頼るとタブのスロットリングで期限切れアクションが実行され得るため。
- `undo()` が reject した場合は `console.error` に残しつつ保持は解除する（同じ失敗するアンドゥを再試行させない）。呼び出し側は失敗をトーストで通知する。
- `register` 時に前のタイマーを必ず `clearTimeout` する（リーク・誤通知の防止）。
- DOM / React / chrome API に依存しない。`setTimeout` / `Date.now` のみ利用し、vitest のフェイクタイマーでテスト可能にする。

### 2. `SearchEngine` のインクリメンタル索引更新（既存ファイルへ追加）

**責務**: 編集・削除・復元の結果を索引へ即時反映する。

```typescript
updateNode(id: string, patch: { title?: string; url?: string }): void;
removeNode(id: string): void;
addNode(node: BookmarkNode, folderPath: string[], aliases: string[]): void;
```

**実装の要点**:
- `updateNode` は該当エントリの `node.title` / `node.url` を差し替え、`nTitle`（正規化済みタイトル）を再計算する。URL 変更時は `aliases` を**引き継がない**（別名は URL ハッシュ紐付けのため、URL が変われば別レコードになる）。この挙動は既存 `updateAliases` の「hashUrl 一致で適用」と整合する。
- `addNode` は `folderPath` と `aliases` を呼び出し側から明示的に受け取る。アンドゥ復元では `chrome.bookmarks.create` が**新しい ID を採番する**（UC-5 の注記どおり）ため、削除前に退避しておいた値をそのまま渡す設計にする。
- 全再構築（`loadIndex`）を使わない理由: chrome API 往復のレイテンシと、再構築中に結果が空になる瞬間を避けるため。`search()` の同期性という U6 の前提も保たれる。
- 既存 `updateAliases` と同じく、不正 URL は握り潰して索引全体を壊さない。

### 3. `inlineEditModel.ts`（`pages/popup/src/components/`・新規・純粋）

**責務**: インライン編集の判断ロジック（URL 検証・確定内容の決定）を React から切り離し、ユニットテスト可能にする。既存の `aliasEditorModel.ts` / `folderTreeModel.ts` と同じ「純粋モジュール + co-located テスト」パターン。

```typescript
/** URL 検証。確定可否とエラーメッセージを返す。 */
type UrlValidation = { ok: true } | { ok: false; message: string };
const validateUrl = (raw: string): UrlValidation;

/** 元の値と下書きの差分から、実際に呼ぶべき更新内容を決める。 */
interface EditDraft { title: string; url: string }
type CommitPlan =
  | { type: 'invalid'; message: string }                // URL 不正 → 確定不可
  | { type: 'unchanged' }                               // 差分なし → API を呼ばず閉じるだけ
  | { type: 'update'; title?: string; url?: string };    // 変化したフィールドのみ
const planCommit = (original: EditDraft, draft: EditDraft): CommitPlan;
```

**URL 検証ルール**（受け入れ条件に対応）:
- 空文字 / 空白のみ → 不正（「URL を入力してください」）。
- `new URL(raw)` が throw → 不正（「URL の形式が正しくありません」）。スキームなしの `example.com` はここで弾かれる。
- `javascript:` / `data:` スキーム → 不正（「このスキームの URL は登録できません」）。ブックマークレット経由のスクリプト実行を持ち込まないため（development-guidelines のセキュリティ観点）。
- それ以外のスキーム（`http` / `https` / `chrome` / `file` 等）は許可する。既存ブックマークには `chrome://` 等が含まれ得るため、`http(s)` 限定にすると編集不能な行が生まれる。

**タイトルの扱い**: 空タイトルは chrome 上も有効（URL が表示される）ため検証しない。前後の空白のみ `trim` して比較・保存する。

### 4. `InlineEdit.tsx`（`pages/popup/src/components/`・新規）

**責務**: デザイン状態1d の展開編集フォーム（repository-structure の `RowEditor` に相当）。

**実装の要点**:
- 内部 state は `draft: { title, url }` と URL エラーのみ。永続化は `onCommit(plan)` で親（`useRowActions`）へ委譲する。
- **フォーカスアウト確定**: フォーム全体を `<div onBlur={...}>` で包み、`e.relatedTarget` が**フォーム外**のときのみ確定する。これによりタイトル⇄URL 間の `Tab` 移動では確定しない（受け入れ条件）。`relatedTarget` が `null`（ポップアップが閉じる・ウィンドウがフォーカスを失う）のケースも「外へ出た」とみなして確定する — PRD 機能4「ポップアップが閉じる事故で入力が消えるのを防ぐ」の意図に沿う。
- **キー処理**: `AliasEditor` と同じ規律で、フォームが処理するキー（`Enter` / `Escape`）は `e.stopPropagation()` して document レベルの LIST ハンドラへ伝播させない。ただしキーの**意味論は `modeMachine.resolveKeyIntent('INLINE_EDIT', e)` から取得**し、キー割り当てを再発明しない（U8 の single source of truth を維持）。
  - このために `resolveKeyIntent` の第3引数 `listFocus` を**省略可能**にする（LIST 以外のモードでは参照されない引数のため）。`useMode.resolveKey` 側は従来どおり必須で渡す。
- `Enter` → `planCommit` を実行。`invalid` ならエラー表示のまま留まる、それ以外は `onCommit` → 親が LIST へ戻す。
- `Escape` → `onCancel`（破棄）。
- URL 入力は `onChange` のたびに `validateUrl` を実行して赤枠/エラー文を即時反映する（確定時の再検証も行う）。
- マウント時にタイトル入力へフォーカスし、**全選択**する（リネームの主用途は書き換えのため）。
- 視覚仕様は docs/design 1d に従う: `padding: 14px 16px` / `gap: 10px` / `shadow-edit-row` / タイトル入力 h34 accent枠 + focus ring / URL 入力 h32 `border-line-input` `bg-input-bg` monospace 12px。デザイン1dの「保存 / キャンセル」ボタンも配置し、マウスでも確定・破棄できるようにする（キーボードは Enter / Escape）。**別名チップ列は非採用**（U9 の AliasEditor が担当・requirements スコープ外参照）。

### 5. `Toast.tsx`（`pages/popup/src/components/`・新規）

**責務**: アンドゥトースト（および操作失敗の通知）を表示する。

```typescript
interface ToastProps {
  message: string;
  actionLabel?: string;         // 例:「元に戻す」
  onAction?: () => void;
  onDismiss: () => void;
  tone?: 'default' | 'danger';  // エラー通知は danger
}
```

**実装の要点**:
- ポップアップ内の absolute 配置（`PopupShell` を包むラッパを `relative` にし、下端中央）。結果行の仮想スクロールに影響を与えない。
- アンドゥボタンは `<button>`（マウス手段）。キーボード手段は `Ctrl/Cmd+Z`（document リスナー）で担保するため、トースト自体はフォーカスを奪わない（検索ボックスのフォーカスを維持する）。
- `role="status"` / `aria-live="polite"`（スクリーンリーダー通知。フォーカスは移動させない）。
- 表示・非表示の判断は行わない（親が `pending` / `error` の有無で出し分ける）。トーストは表示専用に保つ。

### 6. `useUndo.ts`（`pages/popup/src/hooks/`・新規）

**責務**: `UndoManager`（モジュールスコープの単一インスタンス）を React state に橋渡しする。

```typescript
interface UseUndoApi {
  pending: UndoableAction | null;                                // 表示中のアンドゥ対象
  register: (label: string, undo: () => Promise<void>) => void;  // expiresAt を内部で付与
  undoLatest: () => void;
  dismiss: () => void;
}
```

**実装の要点**:
- `useEffect` + `subscribe` で購読する（更新頻度が低く購読解除も単純なため `useSyncExternalStore` は使わない）。`subscribe` は購読時に現在値を1度通知する契約にして初期値のズレを防ぐ。
- `UndoManager` インスタンスは `services.ts` に置き、`searchEngine` / `aliasStore` と同様「UI 各所で `new` しない」方針を守る。

### 7. `useRowActions.ts`（`pages/popup/src/hooks/`・新規）

**責務**: リネーム / URL編集 / 削除 のオーケストレーション（データレイヤー呼び出し → 索引更新 → 再検索 → アンドゥ登録 → 失敗時の通知）。`Popup.tsx` の肥大化を防ぐ。

```typescript
interface UseRowActionsApi {
  commitEdit: (item: SearchResultItem, plan: CommitPlan) => Promise<void>;
  deleteRow: (item: SearchResultItem) => Promise<void>;
  error: string | null;      // 失敗通知（Toast の danger 表示に使う）
  clearError: () => void;
}
```

**実装の要点**:
- 引数は `SearchResultItem` を丸ごと受け取る。`folderPath` / `aliases` / `node` が**すでに索引に載っている**ため、削除前に `getFolderPath` / `getByUrl` を呼ぶ chrome API 往復が不要になる（UC-5 の「元パス取得・別名退避」を索引からの取得で代替する）。
- 削除の順序は UC-5 に従う: 退避データ組み立て（索引から）→ `bookmarkService.remove` → `aliasStore.remove` → 索引から除去 → アンドゥ登録。`remove` が失敗した場合は索引を触らずエラー通知のみ（UI と実データの乖離を作らない）。
- `aliasStore.remove` のみ失敗した場合は、ブックマークは既に消えているため索引除去とアンドゥ登録は行い、別名の残留を `console.error` に記録する（アンドゥ時の `upsert` で上書きされ整合する）。
- アンドゥ処理: `ensureFolderPath(folderPath)` → `create({url, title, parentId})` → `aliases.length > 0` なら `aliasStore.upsert(url, aliases)` → `searchEngine.addNode(created, folderPath, aliases)` → `refresh()`。
- **U16 への接続点**: 削除処理の「`remove` の直前」に `TrashStore.push(...)` を差し込むだけで2層防御が完成するよう、退避データの組み立て（`{url, title, folderPath, aliases}`）を独立した関数に切り出しコメントで明示する。

### 8. `Popup.tsx` / `ResultList.tsx` / `ResultRow.tsx` の変更

**`Popup.tsx`**:
- `INLINE_EDIT` の対象行を `mode.targetId` から解決する（`ALIAS_EDIT` と同じ既存パターン）。
- document キーハンドラに以下を追加:
  - `resolveShortcutIntent` の結果が `inline-edit` → `enterInlineEditAt(selectedIndex)`（U8 で定義済み・未結線だったものを結線）。
  - `delete` → **`listFocus === 'result'` のときのみ** `deleteRow`。検索ボックスにフォーカスがある間の `Delete` は前方削除としてネイティブに委ねる（受け入れ条件）。
  - `undo` → **アンドゥ対象が保持されているときのみ** `undoLatest()` + `preventDefault()`。保持がなければ何もせずネイティブの取り消し（検索ボックスのテキスト取り消し）に委ねる。これにより `Ctrl+Z` の乗っ取りが5秒のトースト表示中に限定される。
- `INLINE_EDIT` 中は既存の LIST / FOLDER_TREE 分岐に入らず、検索ファースト復帰も `isSearchFirstExempt('INLINE_EDIT') === true` により抑止される（U8 で実装済み・変更不要）。
- dimmed: `INLINE_EDIT` 中はヘッダーと左ペインを `opacity-45` にする（ラッパ div で適用。`SearchHeader` / `FolderTree` 自体は変更しない — U8a で sidebar のフォーカスリングを親側で付けたのと同じ方針）。
- `Toast` を `PopupShell` に重ねて描画する（`pending` があればアンドゥトースト、`error` があれば danger トースト）。

**`ResultList.tsx`**:
- `editingInlineId` を受け取り、該当行を編集フォームとして描画させる。
- 編集行の高さ超過分の上乗せを、別名編集（80px）とインライン編集（140px）で出し分ける（既存 `EDITING_ROW_EXTRA` を用途別の定数へ整理）。
- `dimmed`（編集中の非対象行）を `ResultRow` へ伝える。

**`ResultRow.tsx`**:
- `editingInline` のとき `InlineEdit` を描画する（`editingAlias` と同じ分岐パターン）。
- 通常時: ホバーで行右端に「編集」「削除」アイコンをフェードインさせる（docs/design「hover: 右端に編集/削除アイコンをフェードイン」）。行全体が `<button>` であるため、**アイコンはネスト `<button>` にせず** `data-row-action="edit" | "delete"` を持つ `<span>` とし、既存の別名エリア（`data-alias-area`）と同じ `closest()` 分岐でクリックを振り分ける（ネストした interactive 要素を作らない既存方針の踏襲）。
- ダブルクリック（`onDoubleClick`）でインライン編集に入る（docs/design「行ダブルクリック → 1d」）。

**`useSearch.ts`**:
- `refresh(): void` を公開する（現在の索引・クエリで再検索し `results` を更新）。既存 `updateAliases` は内部でこれを使う形に整理する。

**`modeMachine.ts`**:
- `ShortcutIntent` に `'delete'` / `'undo'` を追加し、`resolveShortcutIntent` で `Delete`（修飾なし）と `Ctrl/Cmd+Z`（Shift なし = Redo と区別）を解決する。`SHORTCUTS` 定数にも追記する。
- `resolveKeyIntent` の第3引数 `listFocus` を省略可能にする（既定 `'search'`。LIST 以外では未参照）。

## データフロー

### UC: インラインでリネーム（Enter 確定）
```
1. 右ペインで F2 → resolveShortcutIntent='inline-edit' → useMode.enterInlineEdit(node.id)
2. ResultRow が InlineEdit を描画 → タイトル入力へフォーカス + 全選択
3. ユーザーが書き換え → Enter
4. InlineEdit: resolveKeyIntent('INLINE_EDIT', e) === 'inline:confirm'
   → planCommit(original, draft) → { type: 'update', title }
5. useRowActions.commitEdit: bookmarkService.rename(id, title)
6. searchEngine.updateNode(id, { title }) → useSearch.refresh()
7. mode.exitToList() + 検索ボックスへフォーカス復帰（検索ファースト）
```

### UC: URL 不正で確定不可
```
1. URL 入力を "http//broken" に書き換え
2. onChange → validateUrl → { ok:false, message } → 赤枠 + 行下にエラー表示
3. Enter → planCommit が { type:'invalid' } を返す
   → onCommit を呼ばず INLINE_EDIT に留まる（chrome API は呼ばれない）
4. フォーカスアウトでも同様に確定されない（invalid なら閉じない）
```

### UC: 削除 → 5秒アンドゥ（functional-design UC-5 の第1層）
```
1. 右ペインで Delete（または削除アイコン）
2. 索引から退避データを組み立て: { url, title, folderPath, aliases }
   （※U16 ではこの直後に TrashStore.push が入る）
3. bookmarkService.remove(id) → aliasStore.remove(url)
4. searchEngine.removeNode(id) → refresh() → 行が消え選択がクランプされる
5. undoManager.register({ label:「◯◯」を削除しました, undo, expiresAt: now+5000 })
6. Toast 表示（[元に戻す]）
7a. 5秒以内に [元に戻す] クリック / Ctrl+Z
    → ensureFolderPath → create → aliasStore.upsert → addNode → refresh()
7b. 5秒経過 → UndoManager が自動破棄 → Toast が消える
```

## エラーハンドリング戦略

### カスタムエラークラス
新規のカスタムエラーは定義しない。本単位が扱う失敗は「chrome API 呼び出しの失敗」に集約され、種別で UI を出し分ける必要がないため（既存 `AliasLimitError` のような分岐が生じない）。

### エラーハンドリングパターン
- **編集の失敗**: `rename` / `updateUrl` が reject → 索引を更新せず、`error` にメッセージを設定して danger トーストで通知。編集モードは閉じる（下書きは失われるが、実データは変更されていない）。`console.error` に原因を残す。
- **削除の失敗**: `remove` が reject → 索引を触らず（行は消えない）エラートースト。アンドゥは登録しない。
- **アンドゥの失敗**: `undo()` が reject → `UndoManager` が保持を解除しつつ `console.error`。呼び出し側はエラートーストで通知する。
- **握り潰し禁止**: すべての `catch` で `console.error` を出す（development-guidelines「エラーを握り潰さない」）。外部送信は行わない。

## テスト戦略

`pages/popup` の vitest は `environment: 'node'` / `include: ['src/**/*.test.ts']` であり、**React コンポーネントのテストは対象外**（UI 主要導線は E2E が担保する既定方針）。したがって本単位でも「純粋ロジックを分離してユニットテスト、UI 結線は E2E / 手動検証」という既存方針を踏襲する。

### ユニットテスト
- `packages/shared/lib/undo/UndoManager.test.ts`（新規）
  - `register` → `undoLatest` で `undo()` が1回実行される / 実行後は保持が解除される
  - 期限切れ後の `undoLatest` は `undo()` を実行しない（フェイクタイマー）
  - 期限到達で自動破棄され購読者に `null` が通知される
  - 2回 `register` で最新のみ保持（前のアクションはアンドゥされない）
  - `subscribe` が購読時に現在値を通知し、解除後は通知されない
  - `undo()` が reject しても保持が解除される
- `packages/shared/lib/search/SearchEngine.test.ts`（追記）
  - `updateNode` でタイトルが変わり、新タイトルで検索ヒットする / 旧タイトルではヒットしない
  - `updateNode` で URL が変わる
  - `removeNode` で対象が検索結果から消える
  - `addNode` で追加したエントリが検索・ブラウズ結果に現れ、別名でもヒットする
  - 存在しない ID を指定しても索引が壊れない
- `pages/popup/src/components/inlineEditModel.test.ts`（新規）
  - `validateUrl`: 正常 URL / 空文字 / スキームなし / `javascript:` / `data:` / `chrome://`
  - `planCommit`: 差分なし → `unchanged` / タイトルのみ変更 → `update{title}` / URL のみ変更 → `update{url}` / 両方変更 / URL 不正 → `invalid`
  - `planCommit`: タイトル前後の空白は `trim` して比較する（空白だけの変更を更新扱いにしない）
- `pages/popup/src/hooks/modeMachine.test.ts`（追記）
  - `resolveShortcutIntent`: `Delete` → `'delete'` / `Ctrl+Z` → `'undo'` / `Ctrl+Shift+Z` → `null`（Redo は未定義）/ `Ctrl+E` は従来どおり `'inline-edit'`
  - `resolveKeyIntent('INLINE_EDIT', …)`: `Enter` → `inline:confirm` / `Escape` → `inline:discard` / `ArrowUp` → `none`（第3引数を省略しても同じ結果）

### 統合テスト
既存方針どおり自動化はしない（`chrome.*` モックを伴う統合テストは未整備）。以下を**手動検証項目**として tasklist の検証フェーズに含める:
- 編集 → 索引反映 → 再検索でのヒット
- 削除 → トースト → `[元に戻す]` / `Ctrl+Z` → 復元（別名が戻ること）
- 削除 → 5秒待機 → トースト消滅 → `Ctrl+Z` が無反応

## 依存ライブラリ

新規の依存追加はなし。

## ディレクトリ構造

```
packages/shared/lib/
├── undo/
│   ├── UndoManager.ts          # 新規: 即時アンドゥ（1件・5秒・subscribe）
│   ├── UndoManager.test.ts     # 新規
│   └── index.ts                # 新規: 公開エクスポート
├── search/SearchEngine.ts      # 変更: updateNode / removeNode / addNode
└── search/SearchEngine.test.ts # 変更: 索引更新のテスト追記
packages/shared/index.mts       # 変更: ./lib/undo/index.js を再エクスポート

pages/popup/src/
├── components/
│   ├── InlineEdit.tsx          # 新規: 状態1d フォーム
│   ├── inlineEditModel.ts      # 新規: URL検証・確定計画（純粋）
│   ├── inlineEditModel.test.ts # 新規
│   ├── Toast.tsx               # 新規: アンドゥ/エラートースト
│   ├── ResultRow.tsx           # 変更: 編集フォーム分岐・hover アクション・dblclick・dimmed
│   └── ResultList.tsx          # 変更: editingInlineId / dimmed / 高さ上乗せの出し分け
├── hooks/
│   ├── useUndo.ts              # 新規: UndoManager の React バインディング
│   ├── useRowActions.ts        # 新規: 編集/削除のオーケストレーション
│   ├── useSearch.ts            # 変更: refresh() を公開
│   ├── modeMachine.ts          # 変更: delete/undo ショートカット・listFocus 省略可
│   └── modeMachine.test.ts     # 変更: 追記
├── services.ts                 # 変更: undoManager インスタンスを追加
└── Popup.tsx                   # 変更: INLINE_EDIT 結線・Delete/Ctrl+Z・Toast・dimmed

docs/
├── product-requirements.md     # 変更: Ctrl+Z 追加・未確定論点 #1/#5 の解消
└── functional-design.md        # 変更: INLINE_EDIT の Tab・アンドゥのキー手段
```

## 実装の順序

ボトムアップ（サービス → UI）で進め、各段でテストを先に通す。

1. `UndoManager` + テスト、`packages/shared` からのエクスポート
2. `SearchEngine` の索引更新 API + テスト
3. `inlineEditModel` + テスト
4. `modeMachine` の拡張（`delete` / `undo` / `listFocus` 省略可）+ テスト
5. `useSearch.refresh` / `services.ts` の `undoManager`
6. `useUndo` / `useRowActions`
7. `Toast.tsx` / `InlineEdit.tsx`
8. `ResultRow` / `ResultList` の結線（編集フォーム・hover アクション・dimmed）
9. `Popup.tsx` の結線（ショートカット・トースト・dimmed）
10. `docs/` の永続ドキュメント更新
11. 品質ゲート（test / lint / type-check）

## セキュリティ考慮事項

- **URL スキームの検証**: `javascript:` / `data:` を拒否する。ユーザー自身が入力する値であっても、後続でリンクとして開かれる（`bookmarkService.openUrl`）ため、スクリプト実行につながる URL をブックマークとして保存させない。
- **外部通信ゼロの維持**: 本単位では `fetch` / XHR / WebSocket を一切追加しない。URL の検証は `new URL()` によるローカルなパースのみで、到達性の確認（HTTP リクエスト）は行わない。
- **権限追加なし**: `bookmarks` / `storage` の既存権限のみで完結する。

## パフォーマンス考慮事項

- 索引更新は**全再構築を避け**、対象エントリのみ差し替える（`updateNode` / `removeNode` は O(n) の線形走査だが chrome API 往復を伴わないため、1,000件規模でも1文字あたり100ms要件に影響しない）。
- 編集フォームの展開により行高が可変になるが、仮想スクロールは固定行高前提のため、`ResultList` の総スクロール高に編集行の超過分を上乗せする既存手法（U9 の `EDITING_ROW_EXTRA`）を踏襲する。
- トーストは `pending` / `error` の有無でのみ再描画され、結果リストの再描画を誘発しない。
- `UndoManager` のタイマーは最大1本（`register` のたびに前を解除）。

## 将来の拡張性

- **U12（移動）/ U13（一括操作）**: `UndoManager` は `label` と `undo()` のみに依存するため、移動アクション・一括アクションをそのまま登録できる。一括は「20件をまとめて戻す1つの `undo()`」として登録すれば PRD の「一括アンドゥは1単位」を自然に満たす。
- **U16（ゴミ箱）**: `useRowActions` の削除処理で組み立てる退避データ（`{url, title, folderPath, aliases}`）が `TrashItem` の構成要素とそのまま一致する。`remove` の直前に `TrashStore.push` を1行差し込むだけで2層防御が完成する。
- **U19（状態復元）**: 本単位は `INLINE_EDIT` を一時的なモードとして扱い、永続化しない（復元対象はフォーカス位置・スコープ・選択・クエリの4項目のみ）。設計上の干渉はない。
