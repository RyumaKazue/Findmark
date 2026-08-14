# 設計書

**作業単位**: U17 `service-worker`

## アーキテクチャ概要

`architecture.md` のレイヤー依存（UI → サービス → データ）を維持したまま、**背景（Service Worker）レイヤー**を最下段に置く。SW は「イベント受信 + 既存のサービス/データレイヤーの呼び出し」だけを行い、ドメインロジックを持たない（`functional-design.md`「バックグラウンドは薄く保つ」）。

テスト可能性のため、SW を **副作用（イベント登録・chrome API 実体の結線）** と **純粋ロジック（何を消すかの判定）** に分割し、後者を DI で受け取る構成にする（`TrashStore` / `AliasStore` の DI 方針に合わせる）。

```
chrome.runtime.onStartup / onInstalled / chrome.commands
        │
        ▼
┌──────────────────────────────────────────────┐
│ background/index.ts   … イベント登録のみ(副作用)  │
├──────────────────────────────────────────────┤
│ background/services.ts … 実体の結線(DI 組み立て)  │
├──────────────────────────────────────────────┤
│ background/cleanup.ts  … 掃除の判定＋手順(純粋寄り)│
│ background/commands.ts … ショートカット割当の検証   │
├──────────────────────────────────────────────┤
│ 既存: BookmarkService / AliasStore / TrashStore  │
│       SettingsStore / LocalStateStore / Normalizer│
└──────────────────────────────────────────────┘
```

## コンポーネント設計

### 1. `chrome-extension/src/background/index.ts`（エントリ）

**責務**:
- `chrome.runtime.onStartup` / `chrome.runtime.onInstalled` にクリーンアップを登録する
- ショートカット割り当て検証を同じ2イベントで実行する
- ボイラープレートのデモコード（`exampleThemeStorage` のログ）を削除する

**実装の要点**:
- リスナー登録は**モジュールのトップレベルで同期的に行う**（MV3 SW は起動のたびに再評価されるため、非同期の後に登録するとイベントを取りこぼす）
- リスナー内は `void runStartupCleanup(deps)` の形にし、Promise の未処理拒否を作らない（`runStartupCleanup` 自身が例外を吸収する）
- `import 'webextension-polyfill'` は既存どおり残す（ボイラープレートの前提）

### 2. `chrome-extension/src/background/services.ts`（結線）

**責務**: `pages/popup/src/services.ts` / `pages/options/src/services.ts` と同じ役割。SW コンテキストで必要な実体を1箇所で生成する。

```ts
export const aliasStore = new AliasStore(normalizer);
export const trashStore = new TrashStore(bookmarkService, aliasStore);
export { bookmarkService, localStateStore, settingsStore, normalizer };
```

**実装の要点**:
- `AliasStore` は `Normalizer` の注入が必須（`packages/storage` は `packages/shared` に依存できない）。既存2コンテキストと同じ合成方法にそろえる
- `@extension/shared` は React 依存（`hoc` / `hooks`）も再エクスポートするため、**ビルド後の `dist/background.js` に React が混入していないこと**を確認する（`sideEffects: false` によりツリーシェイクされる想定。混入していた場合は `packages/shared/lib/search/Normalizer.js` を直接 import する形へ切り替える）

### 3. `chrome-extension/src/background/cleanup.ts`（クリーンアップ）

**責務**:
- ブックマークツリーから現存IDの集合を作る
- `LocalState` の存在しない参照を落とした次状態を作る
- 孤立した別名レコード（猶予期間超過分）を選ぶ
- 上記＋ゴミ箱掃除をオーケストレーションする

**公開する関数（純粋関数は個別にテストする）**:

```ts
/** 猶予期間: 孤立していても直近30日以内に更新された別名は消さない（同期・復元との競合を避ける） */
const ORPHAN_ALIAS_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

interface LiveIds {
  folderIds: Set<string>;   // url を持たないノード
  bookmarkIds: Set<string>; // url を持つノード
  urls: string[];           // url を持つノードの URL
}

/** ツリーを1回走査して現存IDとURLを収集する（純粋） */
const collectLiveIds: (nodes: readonly BookmarkNode[]) => LiveIds;

/** 存在しない参照を落とした LocalState を返す。変更が無ければ null（=書き込み不要） */
const pruneLocalState: (state: LocalState, live: LiveIds) => LocalState | null;

/** 孤立かつ猶予期間を過ぎた別名レコードの URL を返す（純粋） */
const selectOrphanAliasUrls: (
  records: Iterable<AliasRecord>,
  liveHashes: ReadonlySet<string>,
  now: number,
  graceMs?: number,
) => string[];

/** 起動時クリーンアップ本体。3ステップを独立に実行し、結果サマリを返す */
const runStartupCleanup: (deps: CleanupDeps) => Promise<CleanupSummary>;
```

**`CleanupDeps`（最小契約でのDI。テストではモックを注入）**:

```ts
interface CleanupDeps {
  bookmarks: { getTree(): Promise<BookmarkNode[]> };
  aliases: { getAll(): Promise<Map<string, AliasRecord>>; remove(url: string): Promise<void> };
  localState: { get(): Promise<LocalState>; set(value: LocalState): Promise<void> };
  settings: { get(): Promise<UserSettings> };
  trash: { purgeExpired(days: number): Promise<number>; enforceLimits(): Promise<number> };
  normalizer: { hashUrl(url: string): string };
  now?: () => number; // テストで固定するため
}
```

**実装の要点**:
- **`getTree()` は1回だけ呼ぶ**。3ステップで使い回す（起動時の負荷を最小化する）
- **空ツリーガード**（実装時に粒度を2段に分けた）: ブックマーク同期が未完了な状態で全参照を「存在しない」と誤判定する事故を防ぐ（データ損失ゼロの原則）
  - ツリーが完全に空（フォルダもブックマークも0件）→ **3ステップすべてをスキップ**。実プロファイルは必ずルートフォルダ（ブックマークバー等）を持つため、この状態は取得失敗か同期未完了とみなせる
  - フォルダはあるがブックマークが0件 → **別名掃除のみスキップ**。フォルダIDは信頼できるので `LocalState` の掃除とゴミ箱掃除は実行する
- **`hashUrl` の失敗は握って続行**: 不正URL（`javascript:` 等の相対/特殊スキーム）で `TypeError` になりうる。生存側のURLがハッシュ化できない場合は集合に入れないが、その URL は `AliasStore.upsert` 時にも同じ理由で失敗するため別名レコードは存在し得ず、誤判定にならない（この根拠をコメントに残す）
- **各ステップを独立の try/catch** で囲み、失敗しても他ステップを継続する。捕捉した例外は `console.error` に残す（`development-guidelines`「エラーを握り潰さない・想定外はログに残す」。SW の最上位なので上位への伝播先が無い）
- 別名の削除は `AliasStore.remove` を**逐次** await する（`AliasStore` 内部の書き込みキューで直列化されるが、呼び出し側でも意図を明示する）
- サマリ（`{ isLocalStateChanged, removedAliasCount, purgedTrashCount, isSkipped }`）を `console.info` で1行だけ出す（デバッグ可能性。件数0のときは出さない）

### 4. `chrome-extension/src/background/commands.ts`（ショートカット検証）

**責務**: `_execute_action` の割り当て状態を検証し、`LocalState.isShortcutUnassigned` に反映する。

```ts
interface CommandsGateway { getAll(): Promise<{ name?: string; shortcut?: string }[]> }
const syncShortcutAvailability: (deps: {
  commands: CommandsGateway;
  localState: { setShortcutUnassigned(v: boolean): Promise<void> };
}) => Promise<void>;
```

**実装の要点**:
- `_execute_action` の `shortcut` が空文字/未定義なら未割り当て
- 「現在値と同じなら書き込まない」ガードは `localStateStore.setShortcutUnassigned` 側が持つ（読み出しを要求しない）
- 例外は `console.error` で握って握り潰さずログ化（SW 最上位）

### 5. データレイヤーの拡張（`packages/storage`）

- `LocalState` に `isShortcutUnassigned?: boolean` を追加（省略時＝未検証/割り当て済み扱い）
- `localStateStore.setShortcutUnassigned(value: boolean)` を追加（他フィールドを保ったまま更新する既存メソッドと同型）

### 6. Options への案内表示（`pages/options/src/components/SettingsTab.tsx`）

- マウント時に `localStateStore.get()` を読み、`isShortcutUnassigned === true` のときだけ「起動ショートカット」セクションを表示する
- `chrome://extensions/shortcuts` は拡張から直接開けないため、**読み取り専用の input + コピーボタン**で提示する（PRD「コピー可能なテキストで示す方式」）
- UI から `chrome.*` を直接呼ばない（データ層 `localStateStore` 経由。既存 `SettingsTab` と同じ流儀）
- 文言は日本語ベタ書き（i18n 適用は U18）

## データフロー

### UC: ブラウザ起動時クリーンアップ
```
1. chrome.runtime.onStartup 発火 → SW 起動
2. runStartupCleanup(deps)
3. bookmarks.getTree() → collectLiveIds() で現存ID/URL集合を作る
4. ツリーが完全に空 → 掃除をスキップして終了 / ブックマークのみ0件 → step2（別名掃除）だけスキップ（同期未完了ガード）
5. [step1] localState.get() → pruneLocalState() → 差分があれば localState.set()
6. [step2] aliases.getAll() → 生存URLのハッシュ集合と突合
          → selectOrphanAliasUrls()（猶予30日超のみ）→ aliases.remove() を逐次実行
7. [step3] settings.get() → trash.purgeExpired(days) → trash.enforceLimits()
8. サマリを console.info（削除0件なら出力しない）
```

### UC: ショートカット割り当て検証
```
1. chrome.runtime.onInstalled / onStartup 発火
2. chrome.commands.getAll() → name === '_execute_action' を探す
3. shortcut が空 → localState.setShortcutUnassigned(true)
   割り当て済み → false（現在値と同じなら書き込まない）
4. Options 設定タブが true のときだけ案内セクションを表示
```

## エラーハンドリング戦略

### カスタムエラークラス
追加しない。SW のクリーンアップは「失敗しても次回起動で再試行できる」性質であり、UI へ通知する種別分岐が不要なため。

### エラーハンドリングパターン
- 3ステップ + ショートカット検証をそれぞれ try/catch で分離し、部分失敗でも他を継続する
- 捕捉した例外は `console.error('[background] …', e)` に残す（外部送信は行わない＝プライバシー方針）
- クリーンアップは**冪等**。失敗しても次回起動で同じ判定に到達する

## テスト戦略

### ユニットテスト（`chrome-extension/src/background/*.test.ts`・vitest node 環境）

`cleanup.test.ts`:
- `collectLiveIds_入れ子ツリー_フォルダとブックマークを再帰収集する`
- `pruneLocalState_存在しないフォルダID_expandedFolderIdsから除去される`
- `pruneLocalState_存在しないlastUsedFolderId_クリアされる`
- `pruneLocalState_存在しないscopeFolderId_nullへ戻る`
- `pruneLocalState_存在しないselectedBookmarkId_キーごと削除される`
- `pruneLocalState_全参照が現存_nullを返す（書き込み不要）`
- `selectOrphanAliasUrls_現存URLのレコード_削除対象にならない`
- `selectOrphanAliasUrls_猶予期間内の孤立レコード_削除対象にならない`
- `selectOrphanAliasUrls_猶予期間超過の孤立レコード_削除対象になる`
- `runStartupCleanup_ブックマーク0件_掃除をスキップする`
- `runStartupCleanup_期限切れゴミ箱_purgeExpiredとenforceLimitsが呼ばれる`
- `runStartupCleanup_別名削除が失敗_ゴミ箱掃除は実行されconsole.errorが出る`
- `runStartupCleanup_変更なし_localState.setが呼ばれない`

`commands.test.ts`:
- `syncShortcutAvailability_shortcutが空_未割り当てとして記録される`
- `syncShortcutAvailability_shortcut割り当て済み_falseへ戻る`
- `syncShortcutAvailability_現在値と同じ_書き込まない`

### 統合テスト
- 実機確認（受け入れ時）: 拡張をロード → `Ctrl+Shift+F` でポップアップ起動（AC-2-1）、`chrome://extensions/shortcuts` で割り当て解除 → 再起動 → Options に案内が出る（AC-2-4）

## 依存ライブラリ

追加なし（`vitest` は `chrome-extension` の devDependencies に導入済み・U2）。

## ディレクトリ構造

```
chrome-extension/
  src/background/
    index.ts          # 変更（デモ削除・イベント登録）
    services.ts       # 新規
    cleanup.ts        # 新規
    cleanup.test.ts   # 新規
    commands.ts       # 新規
    commands.test.ts  # 新規
  vitest.config.ts    # 変更（passWithNoTests のコメント更新）
packages/storage/lib/
  types.ts                    # 変更（LocalState.isShortcutUnassigned）
  impl/localStateStore.ts     # 変更（setShortcutUnassigned）
pages/options/src/
  services.ts                 # 変更（localStateStore を export）
  components/SettingsTab.tsx  # 変更（ショートカット案内セクション）
docs/
  architecture.md / functional-design.md  # 必要に応じて現状追記（ステップ8）
  mvp-development-flow.md                 # 進捗更新（ステップ8）
```

## 実装の順序

1. データレイヤー拡張（`LocalState.isShortcutUnassigned` + `setShortcutUnassigned`）
2. `background/cleanup.ts` の純粋関数（`collectLiveIds` / `pruneLocalState` / `selectOrphanAliasUrls`）
3. `cleanup.test.ts`（純粋関数）
4. `runStartupCleanup` オーケストレーション + テスト
5. `background/commands.ts` + テスト
6. `background/services.ts` と `index.ts`（デモ削除・イベント登録）
7. Options 設定タブの案内セクション
8. 品質チェック（test / lint / type-check / build と SW バンドル検査）

## セキュリティ考慮事項

- 外部通信を一切追加しない（`fetch`/XHR/WebSocket なし）。ログは `console` のみで外部送信しない
- 新しい権限を要求しない（`bookmarks` / `storage` / `activeTab` / `favicon` の4つのまま。`chrome.commands` は manifest の `commands` キーで利用可能で permission 不要）
- 削除は「猶予期間 + 空ツリーガード + 冪等」で保護し、ユーザーデータの誤消去を避ける

## パフォーマンス考慮事項

- `getTree()` は1回のみ。ID集合は `Set` で O(1) 照合
- `LocalState` は差分があるときだけ書き込む
- 別名の削除は該当チャンクのみ更新（`AliasStore` の既存設計）。通常起動では削除0件で `getAll()` 1回のみ

## 将来の拡張性

- `CleanupDeps` を最小契約にしているため、掃除対象（例: 将来のタグ・frecency データ）が増えても deps 追加のみで拡張できる
- `commands.ts` は将来 `_execute_action` 以外の名前付きコマンドを足す際の受け口になる（その時点で `chrome.commands.onCommand` の実リスナーを追加する）
