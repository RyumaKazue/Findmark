# タスクリスト（U19 popup-state-restore）

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:
```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

---

## フェーズ1: データ層（型・ストア）

- [x] `packages/storage/lib/types.ts` に `PopupSession` 型を追加
  - [x] `focusArea: 'search' | 'result' | 'folderTree'` / `scopeFolderId: string | null` / `selectedBookmarkId?: string` / `query: string`
  - [x] `focusArea` の union が modeMachine の `FocusArea` と同一文字列である旨をコメント明記
- [x] `LocalState` に `session?: PopupSession;` を追加（既定値オブジェクトには足さない＝未保存時 undefined）
- [x] `packages/storage/lib/impl/localStateStore.ts` に `saveSession(session: PopupSession)` を追加
  - [x] `LocalStateStorageType` に型を追加し、他フィールドを保つマージ更新で実装
- [x] `PopupSession` が `@extension/storage` からエクスポートされることを確認（index の再エクスポート）
- [x] `stores.test.ts` に `saveSession` テストを追記（session のみ更新 / 公開 API 存在 / 既定 get() 不変）

## フェーズ2: 純粋ロジック（sessionModel）

- [x] `pages/popup/src/hooks/sessionModel.ts` を新規作成
  - [x] `DEFAULT_SESSION`（folderTree / null / query='' / selectedBookmarkId 未指定）
  - [x] `resolveRestoredScope(sessionScope, exists)`
  - [x] `resolveRestoredIndex(id, resultIds)`
  - [x] `deriveSession(input)`（selectedBookmarkId 未指定時はキー省略）
  - [x] `sessionsEqual(a, b)`
  - [x] 宣言は非 export、末尾で export をまとめる
- [x] `pages/popup/src/hooks/sessionModel.test.ts` を新規作成
  - [x] `DEFAULT_SESSION` の既定値
  - [x] `resolveRestoredScope` の3ケース（存在/非存在/null）
  - [x] `resolveRestoredIndex` の3ケース（未指定/一致/不一致）
  - [x] `deriveSession` のキー省略挙動
  - [x] `sessionsEqual` の同一/差分

## フェーズ3: useSearch の isSettled 追加

- [x] `useSearch.ts` の `UseSearchResult` に `isSettled: boolean` を追加
- [x] `isSettled = debouncedQuery === query` を返す
- [x] 既存呼び出し（Popup）の分割代入を壊さないこと（追加のみ）

## フェーズ4: Popup の復元・保存結線

- [x] セッション読み込み: mount 時に `localStateStore.get()` → `session ?? DEFAULT_SESSION`、`sessionLoaded` フラグ
- [x] `foldersLoaded` フラグ（`onFoldersLoaded` ラッパで真にする）
- [x] 保存 effect（debounce 付き / `hasRestored` 解禁後のみ）
  - [x] 依存: focusArea・scopeFolderId・selectedBookmarkId(=results[selectedIndex]?.node.id)・query
  - [x] `deriveSession` → `sessionsEqual` で差分時のみ `saveSession`、タイマークリーンアップ
- [x] 復元適用 effect（1回のみ / `!hasRestored && sessionLoaded && isIndexReady && foldersLoaded`）
  - [x] scope: `resolveRestoredScope`（`findFolderPath` で存在検証）→ `setScopeFolderId`
  - [x] query: 生 `setQuery(session.query)`
  - [x] focus: `applyFocusArea(session.focusArea)`（folderTree/search/result 分岐、DOM focus/blur）
  - [x] `setPendingSelectId(session.selectedBookmarkId ?? null)`
  - [x] 復元クエリ全選択の保留フラグ（query!=='' && focusArea!=='search'）
  - [x] `setHasRestored(true)`
- [x] 選択行 ID 解決 effect（`pendingSelectId 保留中 && isSettled && isIndexReady`）
  - [x] `resolveRestoredIndex` → `setSelectedIndex` → 保留クリア
- [x] 復元クエリ全選択の消費: 検索ファースト復帰分岐で `focusSearch()` 後に `select()`＋フラグ解除
- [x] ユーザー入力ラッパ `onQueryChange` で全選択保留フラグを解除（`SearchHeader` へ渡す）

## フェーズ5: 品質チェックと修正

- [x] `pnpm test`（storage 54 / shared 75 / popup 119 すべてパス）
- [x] `pnpm lint`（15/15、prettier 自動整形適用）
- [x] `pnpm type-check`（14/14）

## フェーズ6: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.md AC-1〜AC-12）と実装を突き合わせOK/NGを一覧化
- [x] ~~`implementation-validator` サブエージェントで品質検証~~（起動が中断されたためインラインレビューで代替: effect 競合を重点確認）
- [x] ユーザーに検証を依頼し、受け入れ承認（ゲート2）を取得（2026-08-08）

## フェーズ7: ドキュメント更新・振り返り（モード4）

- [x] `docs/mvp-development-flow.md` 進捗表を U19 完了に更新（状態・steering ディレクトリ・DoD）
- [x] 実装後の振り返り（このファイル下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

- ラウンド1（2026-08-08）
  - 不一致内容: ポップアップ起動直後に既定状態（左ペインフォーカス＋スコープ「すべて」）が約0.5秒表示され、その後に復元が適用されるフラッシュが見える。最初から保存状態で表示したい。
  - 分類: A（実装欠陥：復元適用を索引構築完了まで待っており過度に保守的だった）
  - 戻り先: モード2（`Popup.tsx` 復元適用 effect / 保存 effect）
  - 対応: フォーカス/スコープ/クエリの復元ゲートから `isIndexReady` を外し、`sessionLoaded && foldersLoaded`（数ms〜数十ms）で即適用するよう変更。選択行の ID→index 解決は従来どおり `isIndexReady && isSettled` を待つ。これに伴い `hasRestored` が索引完了前に真になるため、保存 effect に `pendingSelectId === null` ガードを追加し、保留中の選択 ID を空で上書き（クロバー）しないようにした。requirements AC-10 / design.md を追従更新。

- ラウンド2（2026-08-08）
  - 不一致内容: ラウンド1修正後も、起動直後の1フレームだけスコープ「すべて」がハイライトされてから保存スコープへ移る（フォルダツリーの行描画が復元スコープ適用より1コミット先行するため）。
  - 分類: A（実装欠陥：復元適用前の既定スコープで行を描画していた）
  - 戻り先: モード2（`FolderTree.tsx` / `Popup.tsx`）
  - 対応: `FolderTree` に `ready` プロップを追加し、`ready === false` の間は行を描画しない（フォルダ取得は継続）。`Popup` から `ready={hasRestored}` を渡し、最初に描画される行が既に復元スコープになるようにした。

- ラウンド3（2026-08-08）
  - 不一致内容: 選択中ブックマークの状態が保存されない（閉じる直前の選択変更が 200ms debounce 待ちのまま、ポップアップの唐突なクローズで失われる）。
  - 分類: A（実装欠陥：debounce のみでクローズ時フラッシュが無かった）
  - 戻り先: モード2（`Popup.tsx`）
  - 対応: 現在状態のセッションスナップショットを毎レンダー ref に保持し、`pagehide` / `visibilitychange`(hidden) で debounce を介さず即時保存するフラッシュ effect を追加。debounce 保存（中間状態）とフラッシュ（最終状態）を併用。保存処理は `persistSession`（等値ガード付き）に共通化。

- ラウンド4（2026-08-08）
  - 不一致内容: ラウンド3後も、再度開くと先頭ブックマークが選択される（=選択が復元されない）。真因は保存でなく**復元**側にあった。`useSearch` が `results` を state+effect で公開していたため、`isIndexReady` が true になったレンダーではまだ `results` が空（旧値）で、選択解決 effect がその空配列に対して走り先頭行(0)へフォールバックして `pendingSelectId` を消していた。
  - 分類: A（実装欠陥：results 公開の1レンダー遅延と選択解決のタイミング競合）
  - 戻り先: モード2（`useSearch.ts`）
  - 対応: `results` を `useMemo` でレンダー中に同期導出するよう変更（索引の内部更新は `indexVersion` カウンタで反映）。これにより索引構築完了と同じレンダーで `results` が確定し、選択解決が実データに対して行われるようになった。`refresh`/`updateAliases` はバージョン加算に置換。既存の検索テストは変更なくパス。

---

## 実装後の振り返り

### 実装完了日
2026-08-08

### 計画と実績の差分

**計画と異なった点**:
- `useSearch` の `results` を state+effect から `useMemo`（同期導出 + `indexVersion`）へ変更した。計画では `isSettled` ゲートだけで選択復元の競合を防げる想定だったが、`results` 公開の1レンダー遅延（索引完了レンダーでは results がまだ空）まで考慮できておらず、検証で顕在化して設計を補強した。
- 復元適用のゲートから `isIndexReady` を外し、フォーカス/スコープ/クエリは `sessionLoaded && foldersLoaded` で即適用に変更（起動直後のフラッシュ回避）。当初は「索引完了後にまとめて適用」で計画していた。

**新たに必要になったタスク**:
- `FolderTree` の `ready` プロップ（復元適用まで行を描画しない）。既定スコープ「すべて」の1フレームのハイライトを消すため。
- クローズ時フラッシュ（`pagehide`/`visibilitychange`）。debounce 待ちの最終変更がポップアップの唐突なクローズで失われるのを防ぐため。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: **4**
  - R1: 起動直後の既定状態フラッシュ（索引完了待ち）→ 復元を索引前倒し（分類A）
  - R2: 1フレームの「すべて」ハイライト → `FolderTree.ready` 行描画ゲート（分類A）
  - R3: 選択が保存されない（debounce+クローズで消失）→ クローズ時フラッシュ追加（分類A）
  - R4: 選択が復元されない（真因は `results` 公開の1レンダー遅延）→ `useMemo` 同期導出（分類A）
- 主な不一致と分類: すべて A（実装欠陥）。設計/要件の前提崩れ（B/C）はなし。
- 受け入れ承認: 2026-08-08

### 学んだこと

**技術的な学び**:
- 「非同期完了フラグ（`isIndexReady`）」と「その結果に依存する派生 state（`results`）」を別々に公開すると、フラグが立つレンダーと結果が揃うレンダーが1つズレる。同期計算できるものは state+effect ではなく `useMemo` でレンダー中に導出すると、この種のタイミング競合を根絶できる。
- 復元は「索引が要る項目（選択の ID→index 解決）」と「要らない項目（フォーカス/スコープ/クエリ）」を分離すると、既定状態のフラッシュを避けつつ 200ms 要件も満たせる。
- ポップアップの状態保存は debounce だけでは最終変更を取りこぼす。`pagehide`/`visibilitychange` フラッシュと併用するのが堅牢（ただしフラッシュ単独には依存しない＝PRD 方針どおり）。

**プロセス上の改善点**:
- 純粋ロジック（`sessionModel`）を早期に切り出したことで、フォールバック仕様の検証が容易だった。UI 側の競合は手動確認に頼らざるを得ず、ユーザーの実機フィードバックで4ラウンド要した。

### 次回への改善提案
- 非同期ロード → 派生結果の公開は、可能な限り `useMemo` 同期導出を第一候補にする（state+effect の遅延を避ける）。
- 状態復元系は「起動直後の見た目（フラッシュ）」と「クローズ時の保存取りこぼし」を計画段階のチェックリストに含める。
