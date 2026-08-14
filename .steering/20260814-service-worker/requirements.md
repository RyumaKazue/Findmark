# 要求内容

**作業単位**: U17 `service-worker` / 対応MVP機能: 前提(1, 信頼性)
**依存**: U4 bookmark-service（✅ 完了）, U5 alias-store（✅ 完了）
**引用元**: [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md)「作業単位一覧」U17 行

## 概要

Manifest V3 の Service Worker を実装し、**ブラウザ起動時のクリーンアップ**（存在しないフォルダID・別名参照・期限切れゴミ箱の掃除）と、**起動ショートカット（`chrome.commands`）の割り当て検証と案内**を担わせる。ボイラープレートのデモコード（`exampleThemeStorage` のログ出力）を置換する。

## 背景

- `docs/architecture.md`「背景(Service Worker)」: **責務は「ブラウザ起動時の掃除(存在しないフォルダID/別名参照のクリーンアップ)、`chrome.commands` のショートカット受信」**。MV3 のため常駐せず、重い処理は持たせない。
- `docs/functional-design.md` L70: 「バックグラウンド(Service Worker)は薄く保つ。検索・編集は Popup の UI スレッドで完結し、Service Worker は起動時の掃除やコマンドショートカット受信のみを担う」。
- 現状 `chrome-extension/src/background/index.ts` はボイラープレートのデモ（`exampleThemeStorage` の取得ログ）のままで、Findmark としての責務を一切果たしていない。
- 実害:
  1. **フォルダIDの残骸**: `LocalState`（`expandedFolderIds` / `lastUsedFolderId` / `session.scopeFolderId` / `session.selectedBookmarkId`）は削除済みのブックマーク・フォルダのIDを保持し続ける。U19 は復元時に既定値へフォールバックするが、**保存値自体は掃除されず単調増加する**（storage.local の無駄・デバッグ困難）。
  2. **孤立した別名レコード**: ブックマークを Chrome 標準UI（拡張外）から削除された場合、`AliasStore` の `AliasRecord` は残り続け、`chrome.storage.sync` の 100KB 枠を圧迫する（`AliasStore` は容量超過で local へ退避する＝同期が止まる）。
  3. **ゴミ箱の期限切れが掃除されない**: `TrashStore.purgeExpired` は現状 **Options のゴミ箱タブを開いたときにしか呼ばれない**（`pages/options/src/components/TrashTab.tsx`）。オプションページを開かないユーザーでは「保持日数（既定30日）を過ぎたら自動削除される」という機能12の約束（PRD 機能12 / architecture.md「バックアップ戦略」）が守られない。
  4. **起動ショートカットが未割り当てでも気づけない**: PRD「起動ショートカットの割り当て」の通り、`Ctrl+Shift+F` は他拡張が先に取得していると**未割り当てのまま**になる。キーボード完結を掲げる本プロダクトで「起動キーが効かない」ことにユーザーが気づけないのは致命的。

## 実装対象の機能

### 1. 起動時クリーンアップ（`chrome.runtime.onStartup` / `onInstalled`）

Service Worker がブラウザ起動時・インストール/更新時に、以下3種の掃除を実行する。3種は互いに独立して実行し、1つが失敗しても他は継続する。

#### 1-1. `LocalState` の存在しない参照の掃除
- `expandedFolderIds`: 現在のブックマークツリーに存在しないフォルダIDを除去する
- `lastUsedFolderId`: 存在しないフォルダIDならクリアする
- `session.scopeFolderId`: 存在しないフォルダIDなら `null`（=「すべて」）へ戻す
- `session.selectedBookmarkId`: 存在しないブックマークIDならキーごと削除する（=先頭行の既定へ）
- 変更が無い場合は書き込まない（無用な `liveUpdate` 通知を出さない）

#### 1-2. 孤立した別名レコードの掃除
- `AliasStore.getAll()` の各レコードについて、対応するブックマークが**現存しない**ものを `AliasStore.remove(url)` で削除する
- 突合は必ず `Normalizer.hashUrl` で行う（生URL比較はしない。development-guidelines「別名・検索対象の比較は必ず `Normalizer` を通す」）
- **誤削除防止のガード（データ損失ゼロの原則）**:
  - **猶予期間**: `updatedAt` が猶予期間（30日）以内のレコードは孤立していても削除しない
  - **空ツリーガード**: ブックマークが1件も無い場合は別名掃除を丸ごとスキップする（ブックマーク同期未完了の可能性があるため）

#### 1-3. ゴミ箱の期限切れ・上限超過の掃除
- `SettingsStore` の `trashRetentionDays` を読み、`TrashStore.purgeExpired(days)` を実行する
- 続けて `TrashStore.enforceLimits()` で件数/容量上限超過分を古い順に退避する

### 2. 起動ショートカット（`chrome.commands`）の割り当て検証と案内

- Service Worker が `chrome.commands.getAll()` で `_execute_action`（U1 で manifest に定義済み・popup 起動）の割り当て状態を検証する
- 未割り当て（`shortcut` が空文字）なら `LocalState.isShortcutUnassigned = true` を記録し、割り当て済みなら `false` に戻す（ユーザーが後から割り当てた場合も次回起動で解消する）
- Options の設定タブで、未割り当てのときだけ案内（`chrome://extensions/shortcuts` をコピー可能なテキストで表示）を出す（PRD「起動ショートカットの割り当て」: 拡張からこのURLは直接開けないため、コピー可能なテキストで示す）

> **補足（`onCommand` を使わない理由）**: `_execute_action` は Chrome の予約コマンドで、押下時に**ブラウザが直接ポップアップを開く**。`chrome.commands.onCommand` には配信されない（Chrome 仕様）ため、リスナーを置いてもデッドコードになる。したがって「ショートカットで popup 起動」の実体は manifest の `commands._execute_action`（U1 完了済み）が担い、U17 は**その割り当てが実際に有効かを検証・可視化する**ことで受け入れ基準を担保する。

### 3. ボイラープレート除去

- `exampleThemeStorage` の取得とデモ用 `console.log` を削除し、Findmark の責務のみを残す

## 受け入れ条件

### 引用元（`docs/mvp-development-flow.md` U17 の受け入れ基準）
- [ ] **AC-1**: 起動時に孤立参照を掃除する
- [ ] **AC-2**: ショートカットで popup 起動できる

### AC-1 の詳細化（検証可能な条件）
- [ ] AC-1-1: `chrome.runtime.onStartup` と `chrome.runtime.onInstalled` の両方でクリーンアップが起動する
- [ ] AC-1-2: 現存しないフォルダIDが `expandedFolderIds` から除去される
- [ ] AC-1-3: 現存しないフォルダIDの `lastUsedFolderId` がクリアされる
- [ ] AC-1-4: 現存しないフォルダIDの `session.scopeFolderId` が `null` に戻る
- [ ] AC-1-5: 現存しないブックマークIDの `session.selectedBookmarkId` が削除される
- [ ] AC-1-6: 掃除対象が無い場合は `LocalState` に書き込みが発生しない
- [ ] AC-1-7: 現存するブックマークに対応する別名レコードは削除されない（`Normalizer.hashUrl` で突合）
- [ ] AC-1-8: 猶予期間（30日）以内に更新された孤立別名レコードは削除されない
- [ ] AC-1-9: ブックマークが0件のときは別名掃除がスキップされる（同期未完了時の誤削除防止）
- [ ] AC-1-10: `trashRetentionDays` を過ぎたゴミ箱項目が起動時に削除される（Options を開かなくても掃除される）
- [ ] AC-1-11: 3種の掃除のいずれかが例外を投げても、他の掃除は実行され、`console.error` にログが残る（握り潰さない）

### AC-2 の詳細化（検証可能な条件）
- [ ] AC-2-1: `Ctrl+Shift+F`（mac: `Command+Shift+F`）でポップアップが起動する（実機確認。manifest `commands._execute_action`）
- [ ] AC-2-2: `_execute_action` が未割り当てのとき `LocalState.isShortcutUnassigned` が `true` になる
- [ ] AC-2-3: 割り当て済みのとき `isShortcutUnassigned` が `false` に戻る
- [ ] AC-2-4: 未割り当て時のみ、Options の設定タブに `chrome://extensions/shortcuts` の案内が表示される

### 品質・規約
- [ ] AC-3-1: `pnpm test` / `pnpm lint` / `pnpm type-check` が全てパスする
- [ ] AC-3-2: クリーンアップの純粋ロジックにユニットテストがある（`chrome-extension` の vitest が実テストを持つ状態になる）
- [ ] AC-3-3: Service Worker は「薄い」まま（検索・編集などのドメインロジックを持たない）
- [ ] AC-3-4: 外部通信（`fetch`/XHR/WebSocket）を追加していない
- [ ] AC-3-5: ボイラープレートのデモコード（`exampleThemeStorage` のログ）が残っていない

## 成功指標

- ブラウザ起動時のクリーンアップが数百件規模のブックマーク・別名でも数百ms以内に完了する（`getTree` 1回 + `getAll` 1回 + 差分書き込みのみ）
- 拡張外でブックマークを削除し続けても、`chrome.storage.sync` の別名レコードが単調増加しない

## スコープ外

以下はこのフェーズでは実装しません:

- `_locales` による多言語化（Options に追加する案内文含む）→ **U18 release-prep**
- ショートカット一覧表示（`?` キー）などの UI 追加 → PRD「マウス依存が残る操作」の別課題
- `chrome.bookmarks.onRemoved` 等のイベント駆動リアルタイム同期（MV3 の SW 常駐しない前提と「薄く保つ」方針に反するため、起動時バッチのみとする）
- ゴミ箱への「孤立別名の退避」（別名は `TrashItem.aliases` として削除時に退避済みであり二重化しない）
- アイコン・ストア素材・プライバシーポリシー → **U18 release-prep**

## 参照ドキュメント

- `docs/mvp-development-flow.md` - U17 行（受け入れ基準の引用元）
- `docs/product-requirements.md` - 機能12（ゴミ箱）/「起動ショートカットの割り当て」
- `docs/functional-design.md` - L70「バックグラウンドは薄く保つ」
- `docs/architecture.md` - 「背景(Service Worker)」責務 /「バックアップ戦略」
- `docs/development-guidelines.md` - エラーハンドリング / Findmark 固有のルール / テスト戦略
- `docs/repository-structure.md` - `chrome-extension/src/background/` の配置
