# タスクリスト

**作業単位**: U16 `trash`（MVP機能12「ゴミ箱(削除データの保持・復元)」）

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
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

## フェーズ1: データモデル（packages/storage）

- [x] `packages/storage/lib/types.ts` にゴミ箱の型を追加
  - [x] `TrashItem`（id / kind / url? / title / folderPath / aliases / children? / deletedAt）を functional-design のとおり定義し、JSDoc で保存先（`storage.local` キー `trash`）と制約を明記
  - [x] `TrashInput`（id / deletedAt を除いた push 入力型・children も再帰的に `TrashInput`）を定義し、採番がストア責務である理由をコメントに残す

## フェーズ2: TrashStore（データレイヤー）

- [x] `packages/storage/lib/impl/trashStore.ts` を新規作成
  - [x] DI 用の構造的インターフェース `TrashBookmarkGateway` / `TrashAliasGateway` を定義（storage → shared の循環依存を避ける理由をコメントに明記）
  - [x] `chrome.storage.local` の `trash` キーの読み書きヘルパ（`loadItems` / `saveItems`）と、`AliasStore` と同方式の書き込み直列化キューを実装
  - [x] `push(input)`: id（`crypto.randomUUID`）・`deletedAt` を再帰的に採番して追加し、内部で `enforceLimits` を適用。ゴミ箱内 ID を返す
  - [x] `list()`: `deletedAt` 降順で返す
  - [x] `restore(id)`: `ensureFolderPath` → bookmark は `create` + `aliases` の `upsert`、folder は `children` を再帰復元。成功時のみゴミ箱から除去
  - [x] `remove(id)` / `clear()` を実装
  - [x] `purgeExpired(retentionDays)`: 保持日数超過分を削除し件数を返す（境界: ちょうど N 日は残す）
  - [x] `enforceLimits(maxItems, maxBytes)`: 件数500件・容量4MB 超過分を `deletedAt` 昇順に削除し件数を返す
  - [x] 定数 `MAX_TRASH_ITEMS` / `MAX_TRASH_BYTES` を export（UI 側の二重定義を防ぐ）
- [x] `packages/storage/lib/impl/index.ts` に `trashStore.js` の再エクスポートを追加

## フェーズ3: TrashStore のユニットテスト

- [x] `packages/storage/lib/impl/trashStore.test.ts` を新規作成
  - [x] インメモリ `chrome.storage.local`（`vi.stubGlobal`）と Gateway スタブのセットアップ
  - [x] `push` が id/deletedAt を採番して保存する / `list` が新しい順で返す
  - [x] `restore`（bookmark）が `ensureFolderPath` → `create` → `upsert` を呼び、ゴミ箱から消える
  - [x] `restore`（bookmark・別名なし）で `upsert` を呼ばない
  - [x] `restore`（folder）が配下ツリーを再帰的に復元する
  - [x] `restore` の失敗時に項目が残る / 存在しない id で throw する
  - [x] `purgeExpired` の境界（30日ちょうどは残す・31日は消える）
  - [x] `enforceLimits` が件数上限超過分を古い順に落とす
  - [x] `enforceLimits` が容量上限超過分を古い順に落とす
  - [x] `push` が内部で上限を適用する
  - [x] 並行 `push`（`Promise.all`）で取りこぼしが起きない
  - [x] `remove` / `clear`
- [x] `packages/storage/vitest.config.ts` のカバレッジしきい値に `lib/impl/trashStore.ts`（80%）を追加（実測97%台）

## フェーズ4: Popup の削除フローへ接続

- [x] `pages/popup/src/services.ts` に `trashStore`（`new TrashStore(bookmarkService, aliasStore)`）を追加
- [x] `pages/popup/src/hooks/bulkActionsCore.ts` を更新
  - [x] `DeleteDeps` に `pushTrash` / `removeTrash` を追加（必須プロパティ）し、`RemovedRecord` に `trashId`（`string | null`・必須）を追加
  - [x] `deleteRowsCore` が削除成功件を `pushTrash` し、失敗しても続行して `trashId` を記録
  - [x] `undoDeleteRowsCore` が `trashId` を持つ件で `removeTrash` を呼ぶ（失敗しても他件を止めない）
- [x] `pages/popup/src/hooks/useRowActions.ts` を更新
  - [x] `deleteRow` が削除成功後に `trashStore.push` し、undo 成功時に `trashStore.remove(trashId)` する
  - [x] `deleteDeps` に `pushTrash` / `removeTrash` を結線
- [x] `pages/popup/src/hooks/bulkActionsCore.test.ts` を更新
  - [x] 既存の `DeleteDeps` スタブに新プロパティを追加してコンパイルを通す
  - [x] `deleteRowsCore` が `pushTrash` を呼び `trashId` を載せるテストを追加
  - [x] `pushTrash` 失敗時も削除が成功扱いになるテストを追加
  - [x] `undoDeleteRowsCore` が `removeTrash` を呼ぶテストを追加（+ `trashId=null` は呼ばないテストも追加）

## フェーズ5: Options（タブ機構 / TrashTab / SettingsTab）

- [x] `pages/options/src/services.ts` に `trashStore` を追加（`settingsStore` の再エクスポートも追加）
- [x] `pages/options/src/Options.tsx` にタブ切り替えを導入
  - [x] タブ定義（インポート/エクスポート・ゴミ箱・設定）と `useState` による切り替え
  - [x] `role="tablist"` / `role="tab"` / `aria-selected` を付与し、選択タブを視覚的に区別する
- [x] `pages/options/src/components/TrashTab.tsx` を新規作成
  - [x] マウント時に `settingsStore.get()` → `purgeExpired(retentionDays)` → `list()` を実行
  - [x] 一覧表示（タイトル / URL / 元フォルダパス / 別名 / 削除日時、フォルダは配下件数）
  - [x] 復元ボタン（成功で一覧から消える・失敗でエラー表示）
  - [x] 個別の完全削除ボタン、ヘッダの「ゴミ箱を空にする」
  - [x] 空状態・読み込み中の表示
- [x] `pages/options/src/components/SettingsTab.tsx` を新規作成
  - [x] 保持日数の選択（7/14/30/60/90）→ `settingsStore.setRetentionDays`
  - [x] locale の選択（ja/en）→ `settingsStore.setLocale`（UI 適用は U18 である旨を注記）
  - [x] 保存状態のフィードバック表示

## フェーズ6: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `pnpm test`
- [x] リントエラーがないことを確認
  - [x] `pnpm lint`（prettier 整形エラー2件を `--fix` で解消）
- [x] 型エラーがないことを確認
  - [x] `pnpm type-check`
- [x] `implementation-validator` サブエージェントによる品質検証と指摘対応
  - 指摘: 一括削除経路(`bulkActionsCore.ts`)の `pushTrash`/`removeTrash` 失敗が無音で握り潰され、AC-1/design.md の「console.error を残す」方針に反していた（単一削除側の `useRowActions.deleteRow` は準拠済み）
  - 対応: 両箇所に `console.error` を追加し、それぞれの失敗を検証するユニットテストを2件追加（`pnpm test`/`lint`/`type-check` 再実行し全通過を確認）

## フェーズ7: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.md AC-1〜AC-6）と実装を突き合わせOK/NGを一覧化
- [x] ユーザーに検証を依頼（削除/復元フロー・ensureFolderPath・kind:'folder'・SearchEngine/AliasStoreとの接続の質疑応答を実施）
- [x] 受け入れ承認（ゲート2）を取得（2026-08-14）
  - NGがあった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ8: ドキュメント更新・振り返り（モード4）

- [x] `docs/functional-design.md` の `TrashStore` 署名（`push` の入力型・追加した `remove`/`clear`）を実装に合わせて更新（UC-5 実装状況注記も U16 で更新）
- [ ] `docs/mvp-development-flow.md` の「進捗」表で U16 を ✅ 完了 に更新し、steering ディレクトリを記載
- [ ] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

- （未記入）

---

## 実装後の振り返り

### 実装完了日
2026-08-14

### 計画と実績の差分

**計画と異なった点**:
- design.md で示した設計方針(DI・書き込み直列化キュー・`push` 入力型の分離・`DeleteDeps` 必須化)はそのまま実装に反映され、大きな乖離はなかった。
- `implementation-validator` の検証で、一括削除経路(`bulkActionsCore.ts`)の `pushTrash`/`removeTrash` 失敗時に `console.error` を出していない箇所が2つ見つかった。design.md のエラーハンドリング表・requirements.md AC-1 は明示的に「コンソールにエラーを残す」を求めていたため、これは計画からの逸脱(実装漏れ)として分類Aの実装欠陥。tasklist は既にフェーズ6として組み込んでいたため、計画承認(ゲート1)の再取得は不要のまま該当箇所を修正し、検証テストを2件追加した。

**新たに必要になったタスク**:
- `bulkActionsCore.test.ts` への `console.error` 呼び出し検証テスト2件(`pushTrash` 失敗時・`removeTrash` 失敗時)は計画時には個別タスクとして書いていなかったが、validator 指摘への対応としてフェーズ6内で追加・実施した。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 0(ゲート1・ゲート2とも1周で完了。validator指摘はフェーズ6内の修正で収まり、モード3の「検証→戻る」フローには至らなかった)
- 主な不一致と分類: なし(受け入れ基準 AC-1〜AC-6 はすべて OK。validator指摘は受け入れ基準自体には影響しない実装品質の指摘で、ユーザーへの提示前に解消済み)
- 受け入れ承認: 2026-08-14

### 学んだこと

**技術的な学び**:
- **Options と Popup は別ランタイム**という前提を復元フローの設計に反映できた。`TrashStore.restore` が `SearchEngine` を呼ばないのは手抜きではなく、Popup が起動のたびに `loadIndex` で実データから索引を作り直す設計(`useSearch.ts`)に支えられた意図的な省略であることを、ユーザーとの質疑を通じて明文化できた(`docs/functional-design.md` UC-5 の実装状況注記に追記)。
- `AliasStore` と同じ DI・直列化キューのパターンを `TrashStore` にも適用したことで、実装判断に迷う箇所がほとんどなく、テストも既存の `aliasStore.test.ts` を土台にスムーズに書けた。既存パターンの一貫性が実装速度に直結することを再確認した。
- `DeleteDeps` に新しいプロパティを**必須**で追加する判断(design.md で事前に明記)は、実際に `bulkActionsCore.test.ts` の既存テストがすべてコンパイルエラーになって修正箇所を型で洗い出せたため、狙いどおり機能した。

**プロセス上の改善点**:
- `implementation-validator` が「AC-1 が要求するログ出力が一部の経路で欠けている」という、テストが通っていても見逃しやすい種類の不整合を発見できた。自動テスト(test/lint/type-check)だけでは検出できない observability 面の抜けを拾う役割を果たしており、検証ステップとして有効だった。
- ユーザーとの受け入れ承認前のQ&A(削除/復元フロー・`ensureFolderPath`・`kind:'folder'`・SearchEngine/AliasStoreの呼び分け)を通じて、`docs/functional-design.md` に反映すべき設計判断(Options/Popup分離・索引再構築のタイミング)が明確になった。承認ゲートの前に質疑応答の時間を取ったことが、結果的にドキュメント更新の質を上げた。

### 次回への改善提案
- フォルダ削除UI(U16のスコープ外)を将来実装する際は、`useRowActions.deleteRow`/`bulkActionsCore` と同じ4点セット(`bookmarkService`→`aliasStore`→`trashStore`→`searchEngine`)のオーケストレーションを新しいフック(例: `useFolderActions`)に切り出す設計を最初から想定しておくと、既存の削除フローとの一貫性を保ちやすい。
- ビルド成果物(`dist/`)のステールさが原因でユーザー側の実機確認と食い違う場面があった。ステアリングのフェーズ6(品質チェック)に「必要であれば `pnpm build` して実機反映する」という確認項目を明示的に加えると、次回以降の受け入れ確認がスムーズになる。
