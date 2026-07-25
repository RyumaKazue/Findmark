# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース
以下の技術的理由に該当する場合のみスキップ可能:
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:
```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

---

## フェーズ0: ドメイン型帰属の確定（案A採用・2026-07-25）

> 案B（storage→shared 型 import）は turbo 循環依存でビルド不可のため却下。案A（型を storage へ移設）を採用。

- [x] （検証）案B を試行し turbo 循環依存を確認 → revert（作業ツリー・lockfile クリーン化済み）
- [x] `BookmarkNode` / `AliasRecord` / `AliasChunk` / `AliasIndex` を `packages/storage/lib/types.ts` へ移設
- [x] `packages/shared/lib/types/bookmark.ts` / `alias.ts` を削除
- [x] `packages/shared/lib/types/search.ts` の `BookmarkNode` import を `@extension/storage` からに変更
- [x] `packages/shared/lib/types/index.ts` を、データ型は `@extension/storage` から再エクスポート・`SearchResultItem`/`FolderScope` は `./search.js` から export に変更
- [x] 循環が無いこと（`turbo run build --dry` がエラーなし）と type-check 通過を確認

## フェーズ1: 設定/状態の型

- [x] `packages/storage/lib/types.ts` に `UserSettings`（trashRetentionDays 既定30 / locale?）を追加
- [x] `packages/storage/lib/types.ts` に `LocalState`（expandedFolderIds / lastUsedFolderId?）を追加

## フェーズ2: BookmarkService

- [x] `impl/bookmarkService.ts` に `class BookmarkService` の骨組みと `toDomain` 写像ヘルパ、既定インスタンス export を用意
- [x] `getTree()` を実装（chrome.bookmarks.getTree → BookmarkNode[] 写像・children 再帰）
- [x] `getFolderPath(nodeId)` を実装（親を辿ってフォルダ名配列を返す）
- [x] `ensureFolderPath(path)` を実装（既存再利用・欠落のみ create・末端 ID 返却・空配列はベース親）
- [x] `create / rename / updateUrl / move / remove` を実装（対応 chrome.bookmarks API）
- [x] `getCurrentTab()` を実装（tabs.query・url/title 欠落フォールバック）
- [x] `faviconUrl(pageUrl, size=16)` を実装（runtime.getURL + searchParams、chrome.runtime.id をデータ層に閉じ込め）

## フェーズ3: SettingsStore / LocalStateStore

- [x] `impl/settingsStore.ts` を `createStorage<UserSettings>('user_settings', ..., Sync)` で実装（利便メソッド含む）
- [x] `impl/localStateStore.ts` を `createStorage<LocalState>('local_state', ..., Local)` で実装（利便メソッド含む）

## フェーズ4: 公開 API（バレル）

- [x] `impl/index.ts` に bookmarkService / settingsStore / localStateStore を追加
- [x] `@extension/storage` から各サービス・型が import できることを確認（フェーズ6 の type-check で担保）

## フェーズ5: ユニットテスト（co-located, chrome モック）

- [x] `impl/bookmarkService.test.ts` を作成
  - [x] `vi.stubGlobal('chrome', mock)` で bookmarks/tabs/runtime を差し替え
  - [x] `getTree`: 写像（不要フィールド除去・children 再帰）
  - [x] `ensureFolderPath`: 既存再利用（create 未呼び出し）/ 欠落のみ create / 末端 ID / 空配列
  - [x] `getFolderPath`: パス配列（順序）
  - [x] `create/rename/updateUrl/move/remove`: 正しい chrome API 引数
  - [x] `getCurrentTab`: 正常 / url 欠落フォールバック / タブ無し
  - [x] `faviconUrl`: pageUrl/size 反映（chrome-extension は非 special スキームのため href/protocol で検証）
- [x] SettingsStore / LocalStateStore の既定値取得・公開 API をスモーク検証（`stores.test.ts`）
- [x] `pnpm -F @extension/storage test` でパスすることを確認（19 tests pass）

## フェーズ6: 品質チェックと修正

- [x] `pnpm -F @extension/storage test` が通ることを確認（19 tests pass）
- [x] `pnpm type-check` がエラーなく通ることを確認（14 tasks 成功）
- [x] `pnpm lint` がエラーなく通ることを確認（15 tasks 成功。duplicate import / prettier 修正済み）
- [x] `pnpm build` が成功し、dist に test ファイルが流出しないことを確認（16 tasks 成功。循環なし）

## フェーズ7: 検証（モード3 / ステップ6・7・7.5）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.mdの各要件）と実装を突き合わせOK/NGを一覧化（全項目OK）
- [x] `implementation-validator` サブエージェントで品質検証（重要2件=getFolderPath/ensureFolderPath 往復整合の欠陥を検出 → 修正済み。中2件=store 利便メソッドのテスト追加済み / doc更新はフェーズ8。検証ログ ラウンド1参照）
- [x] ユーザーに検証を依頼し、受け入れ承認（ゲート2 / ステップ7.5）を取得（2026-07-25 承認取得）
  - NGがあった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ8: ドキュメント更新・振り返り（モード4）

- [x] `docs/mvp-development-flow.md` の進捗表で U4 を「完了」に更新
- [x] （案A採用）`docs/repository-structure.md` の型配置記述を更新（データモデル型は storage、shared は再エクスポート）
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

- ラウンド1（2026-07-25）: `implementation-validator` 検証で以下を検出 → 受け入れ検証前に自己修正。
  - **不一致内容**: `getFolderPath` が対象ノード自身のタイトルをパスに含み、かつ `ensureFolderPath` がブックマークバーを暗黙ベースにしていたため、両者が往復整合しない（`ensureFolderPath(getFolderPath(id))` で元フォルダを再現できず、余分なフォルダを作る）。functional-design:395 の `folderPath` サンプル（トップレベル「ブックマーク バー」を含み、ブックマーク自身は含まない）とも不整合。U15/U16 の契約に影響。
  - **分類**: A（実装欠陥）。計画（design）の意図は往復整合であり、実装のロジック誤り。
  - **戻り先**: モード2（該当メソッドの再実装）。計画再承認（ゲート1）は不要。
  - **対応**: `getFolderPath` を「親から辿り、自身を含めず、真のルートのみ除外（トップレベルフォルダは含む）」に修正。`ensureFolderPath` のベースを真のルートに変更し、空配列は既定書き込み先（ブックマークバー）を返すよう修正。両者を往復整合させ、ブックマーク葉ケース／フォルダケースのテストを追加。あわせて store 利便メソッド（toggleExpanded 等）の実動作テストを追加、`runtime` アクセスを getter に統一。`docs/repository-structure.md` の型配置更新（案A）はフェーズ8で実施。

---

## 実装後の振り返り

### 実装完了日
2026-07-25

### 計画と実績の差分

**計画と異なった点**:
- **型の帰属方針が案B→案Aへ転換**: 計画（ゲート4.5）では案B（storage→shared の型のみ import）を承認いただいたが、実装着手時に **turbo が shared⇄storage の循環依存を検出しビルド不可**と判明。ユーザー再承認のうえ案A（データモデル型を storage へ移設し shared が再エクスポート）へ変更した。依存は `shared → storage` の一方向に確定。
- `BookmarkNode`/`AliasRecord`系（U3 で shared に置いた型）を `packages/storage/lib/types.ts` へ移設。`packages/shared/lib/types/bookmark.ts`・`alias.ts` は削除、`index.ts` は `@extension/storage` からの再エクスポートに変更。

**新たに必要になったタスク**:
- 案A への型移設（storage への集約 + shared 再エクスポート + `search.ts` の import 元変更）。
- `getFolderPath`/`ensureFolderPath` の往復整合の是正（validator ラウンド1・分類A）。
- store 利便メソッドの実動作テスト追加、`docs/repository-structure.md` の型配置更新。

**技術的理由でスキップしたタスク**（該当する場合のみ）:
- なし（全タスク完了）。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 1（validator 検出の分類A=実装欠陥。受け入れ検証前に自己修正、計画再承認は不要）
- 主な不一致と分類: A（実装欠陥）1件＝`getFolderPath`/`ensureFolderPath` の往復不整合。修正済み。
- 受け入れ承認: 2026-07-25 取得

### 学んだこと

**技術的な学び**:
- **型のみの workspace 依存でも turbo は循環依存として扱う**。`import type` はコンパイル時消去されるが、turbo の task graph は package.json の deps/devDeps から構築されるため、shared⇄storage の相互 devDep は `^ready`/`^build` を循環させビルドを壊す。→ レイヤー型は「最下層に置き上位が再エクスポート」で一方向に保つのが正解（案A）。
- `getFolderPath`（読み）と `ensureFolderPath`（書き）は**逆関数として往復整合**していなければならない。トップレベルフォルダ（ブックマークバー）の含む/含まないをズラすと、ゴミ箱復元・インポートで元の場所を再現できない。functional-design のサンプル（folderPath にトップレベル含む・ブックマーク自身は含まない）を契約の正とした。
- chrome-extension の非 special スキーム（`chrome-extension://`）は `URL.origin` が `'null'`（opaque）になる。ファビコン URL の検証は origin ではなく href/protocol/searchParams で行う。

**プロセス上の改善点**:
- 「最小変更に見える案」でも、依存グラフ・ビルドツールへの影響は**実装着手時に実地検証**すべき（案B は机上では最小だが turbo で破綻）。計画段階で `turbo run build --dry` 相当の確認を織り込むと手戻りが減る。
- validator が往復整合の欠陥（テストが緑でも契約破り）を検出。品質ゲート緑 ≠ 契約充足であり、レビューエージェント併用が有効。

### 次回への改善提案
- U5（alias-store）は `AliasStore` を storage に実装。`AliasRecord`/`AliasChunk`/`AliasIndex`（本単位で storage へ移設済み）と `Normalizer.hashUrl`（U3, shared）を使う。storage→shared の逆流入は不可（循環）なので、`hashUrl` の結果は呼び出し側（shared/UI）から渡すか、AliasStore は urlHash を受け取る API 設計にする（レイヤー順守）。
- U5 でチャンク分割（バイト長ベース）・sync/local フォールバックのテストに、本単位と同様 `vi.stubGlobal('chrome', ...)` の chrome.storage モックを使う。