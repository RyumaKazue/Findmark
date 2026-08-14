# タスクリスト

**作業単位**: U17 `service-worker`

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### 実装可能なタスクのみを計画
- 計画段階で「実装可能なタスク」のみをリストアップ
- 「将来やるかもしれないタスク」は含めない
- 「検討中のタスク」は含めない

### タスクスキップが許可される唯一のケース
以下の技術的理由に該当する場合のみスキップ可能:
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:
```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

### タスクが大きすぎる場合
- タスクを小さなサブタスクに分割
- 分割したサブタスクをこのファイルに追加
- サブタスクを1つずつ完了させる

---

## フェーズ1: データレイヤーの拡張（packages/storage）

- [x] `LocalState` に `isShortcutUnassigned?: boolean` を追加（`packages/storage/lib/types.ts`）
  - [x] 用途・既定値の意味（省略＝未検証/割り当て済み扱い）を JSDoc に記載
- [x] `localStateStore.setShortcutUnassigned(value: boolean)` を追加（`packages/storage/lib/impl/localStateStore.ts`）
  - [x] 他フィールドを保ったまま更新する（既存 `saveSession` と同じ流儀）
  - [x] 現在値と同じなら書き込まない（無用な `liveUpdate` 通知を避ける）

## フェーズ2: クリーンアップの純粋ロジック（cleanup.ts）

- [x] `chrome-extension/src/background/cleanup.ts` を新規作成し、方針コメント（責務・SWを薄く保つ根拠）を書く
- [x] `collectLiveIds(nodes)` を実装（フォルダID/ブックマークID/URL を再帰収集）
- [x] `pruneLocalState(state, live)` を実装（変更なしは `null` を返す）
  - [x] `expandedFolderIds` の除去
  - [x] `lastUsedFolderId` のクリア
  - [x] `session.scopeFolderId` の `null` フォールバック
  - [x] `session.selectedBookmarkId` のキー削除
- [x] `selectOrphanAliasUrls(records, liveHashes, now, graceMs)` を実装
  - [x] 猶予期間 `ORPHAN_ALIAS_GRACE_MS`（30日）を定数化し、根拠をコメントに残す

## フェーズ3: 純粋ロジックのユニットテスト

- [x] `chrome-extension/src/background/cleanup.test.ts` を新規作成
- [x] `collectLiveIds_入れ子ツリー_フォルダとブックマークを再帰収集する`
- [x] `pruneLocalState_存在しないフォルダID_expandedFolderIdsから除去される`
- [x] `pruneLocalState_存在しないlastUsedFolderId_クリアされる`
- [x] `pruneLocalState_存在しないscopeFolderId_nullへ戻る`
- [x] `pruneLocalState_存在しないselectedBookmarkId_キーごと削除される`
- [x] `pruneLocalState_全参照が現存_nullを返す`
- [x] `selectOrphanAliasUrls_現存URLのレコード_削除対象にならない`
- [x] `selectOrphanAliasUrls_猶予期間内の孤立レコード_削除対象にならない`
- [x] `selectOrphanAliasUrls_猶予期間超過の孤立レコード_削除対象になる`

## フェーズ4: クリーンアップのオーケストレーション

- [x] `CleanupDeps` / `CleanupSummary` 型を定義（最小契約DI）
- [x] `runStartupCleanup(deps)` を実装
  - [x] `getTree()` は1回だけ呼び、3ステップで使い回す
  - [x] 空ツリーガード（ブックマーク0件なら掃除をスキップ）
  - [x] step1: `LocalState` の掃除（差分があるときだけ `set`）
  - [x] step2: 孤立別名の掃除（`hashUrl` 失敗は握って続行・逐次 `remove`）
  - [x] step3: `purgeExpired(trashRetentionDays)` + `enforceLimits()`
  - [x] 各ステップを独立 try/catch で囲み `console.error` に残す
  - [x] サマリを `console.info`（削除0件なら出力しない）
- [x] `runStartupCleanup` のテストを追加
  - [x] `runStartupCleanup_ブックマーク0件_掃除をスキップする`
  - [x] `runStartupCleanup_孤立別名_removeが呼ばれる`
  - [x] `runStartupCleanup_変更なし_localState.setが呼ばれない`
  - [x] `runStartupCleanup_期限切れゴミ箱_purgeExpiredとenforceLimitsが呼ばれる`
  - [x] `runStartupCleanup_別名削除が失敗_ゴミ箱掃除は実行されconsole.errorが出る`

## フェーズ5: ショートカット割り当て検証（commands.ts）

- [x] `chrome-extension/src/background/commands.ts` を新規作成
  - [x] `CommandsGateway` 最小契約を定義
  - [x] `syncShortcutAvailability(deps)` を実装（現在値と同じなら書き込まない・例外は握ってログ）
  - [x] `_execute_action` が `onCommand` に配信されない Chrome 仕様の根拠をコメントに残す
- [x] `chrome-extension/src/background/commands.test.ts` を新規作成
  - [x] `syncShortcutAvailability_shortcutが空_未割り当てとして記録される`
  - [x] `syncShortcutAvailability_shortcut割り当て済み_falseへ戻る`
  - [x] `syncShortcutAvailability_現在値と同じ_書き込まない`

## フェーズ6: Service Worker エントリの置換

- [x] `chrome-extension/src/background/services.ts` を新規作成（`AliasStore`/`TrashStore` の合成・既存2コンテキストと同じ流儀）
- [x] `chrome-extension/src/background/index.ts` を書き換え
  - [x] ボイラープレートのデモコード（`exampleThemeStorage` の取得と `console.log`）を削除
  - [x] `chrome.runtime.onStartup` / `chrome.runtime.onInstalled` をトップレベルで登録
  - [x] 両イベントで `runStartupCleanup` と `syncShortcutAvailability` を実行
- [x] `chrome-extension/vitest.config.ts` のコメント（「実テストは U17 で追加する」）を現状に合わせて更新

## フェーズ7: Options への案内表示

- [x] `pages/options/src/services.ts` から `localStateStore` を export する
- [x] `SettingsTab.tsx` に「起動ショートカット」セクションを追加
  - [x] `localStateStore.get()` を読み、`isShortcutUnassigned === true` のときだけ表示
  - [x] `chrome://extensions/shortcuts` を読み取り専用テキスト + コピーボタンで提示
  - [x] 既存セクションのスタイル・エラーハンドリング（`console.error` + メッセージ表示）にそろえる

## フェーズ8: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `pnpm test`
- [x] リントエラーがないことを確認
  - [x] `pnpm lint`
- [x] 型エラーがないことを確認
  - [x] `pnpm type-check`
- [x] ビルドが成功することを確認
  - [x] `pnpm build`
  - [x] `dist/background.js` に React が混入していないことを確認（混入時は `Normalizer` の import 経路を変更）
  - [x] `dist/background.js` に `fetch`/XHR/WebSocket が含まれないことを確認（外部通信ゼロ）

## フェーズ9: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.md の AC-1-1〜AC-3-5）と実装を突き合わせ OK/NG を一覧化
- [x] ユーザーに検証を依頼（実機確認項目 AC-2-1 / AC-2-4 を明示）
- [x] 受け入れ承認（ゲート2）を取得（2026-08-14）
  - NGがあった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ10: ドキュメント更新・振り返り（モード4）

- [x] `docs/architecture.md` / `docs/functional-design.md` の Service Worker 記述を実装に合わせて是正（必要に応じて）
- [x] `docs/product-requirements.md`「起動ショートカットの割り当て」に対応済みの追記（計画外・実機事象を受けて追加）
- [x] `docs/mvp-development-flow.md`「進捗」表の U17 行を更新（状態・steering ディレクトリ）
- [x] `docs/mvp-development-flow.md`「作業単位一覧」の U17/U18 行を実装内容に合わせて是正
- [x] 「MVP完成の定義」のチェックボックス更新要否を確認（U1〜U17 完了により `- [x]` へ）
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

**検証→戻り（A/B/C分類による差し戻し）: なし**

参考として、検証フェーズで発生した事象を記録する。

- ラウンド1（2026-08-14・実機確認）
  - 事象: AC-2-1「`Command+Shift+F` でポップアップが起動する」が実機で満たされなかった
  - 切り分け: `dist/manifest.json` に `commands._execute_action`（`Ctrl+Shift+F` / mac `Command+Shift+F`）が正しく出力されていることを確認。実装・ビルド側に欠陥なし
  - 判定: **実装欠陥（分類A）ではなく環境要因**。Chrome は `suggested_key` をインストール/更新時にしか適用せず、他拡張が先に取得していると黙って未割り当てのままにする（PRD「起動ショートカットの割り当て」が予見していた事象そのもの）
  - 対応: コード変更なし。ユーザー承認により受け入れ。この事象を `docs/product-requirements.md` に「実機での確認事項」として追記し、U18（ストア説明文・i18n）への申し送りとした
  - 補足: 未割り当て時の検出と案内（AC-2-2〜AC-2-4）は U17 の実装範囲であり、まさにこの事態を救済するための機能である

---

## 実装後の振り返り

### 実装完了日
2026-08-14

### 計画と実績の差分

**計画と異なった点**:
- **空ツリーガードの粒度を2段に分けた**。計画では「ブックマーク0件なら全掃除をスキップ」としていたが、実プロファイルは必ずルートフォルダ（ブックマーク バー等）を持つため、`live.folderIds` も0件のときだけ全スキップし、「フォルダはあるがブックマーク0件」では別名掃除のみスキップする形にした。フォルダIDが信頼できる状況で `LocalState` の掃除まで止める必要がないため（design.md を実装に合わせて是正済み）。
- **「現在値と同じなら書き込まない」ガードの置き場所**を `commands.ts` から `localStateStore.setShortcutUnassigned` へ移した。データレイヤーに置く方が呼び出し側を問わず効き、既存の `expandFolders` と同じ流儀になる。結果として `ShortcutStateGateway` は `get()` を要求しない最小契約になった（テストも `stores.test.ts` 側へ移動）。
- **Boolean のフィールド名を実装後にリネーム**（`shortcutUnassigned` → `isShortcutUnassigned`、`localStateChanged`/`skipped` → `isLocalStateChanged`/`isSkipped`）。development-guidelines の命名規則（`is`/`has`/`should` 始まり）に反していたことを implementation-validator の指摘で認識した。計画時点の型定義案がそもそも規約違反だった。

**新たに必要になったタスク**:
- `docs/product-requirements.md`「起動ショートカットの割り当て」への対応済み追記。実機で未割り当て事象が実際に発生したため、予見された懸念ではなく「確認された事実」として記録し、U18 のストア説明文への申し送りにする必要が生じた。
- implementation-validator の指摘2件（`collectLiveIds` の例外保護、Boolean 命名）の修正。

**技術的理由でスキップしたタスク**（該当する場合のみ）:
- なし（全タスク完了）。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 0（A/B/C 分類による差し戻しなし）
- 主な不一致と分類: AC-2-1 が実機で満たされなかったが、切り分けの結果 Chrome の `suggested_key` 未適用という環境要因であり、実装欠陥（分類A）ではないと判断。詳細は検証ログ参照
- 受け入れ承認: 2026-08-14 取得

### 学んだこと

**技術的な学び**:
- **`_execute_action` は `chrome.commands.onCommand` に配信されない**。Chrome の予約コマンドはブラウザが直接処理するため、リスナーを置くとデッドコードになる。「`chrome.commands` 受信によるショートカット起動」という当初の作業単位定義は Chrome の実仕様と噛み合っておらず、SW の役割を「起動の受信」から「割り当て状態の検証」へ読み替える必要があった。**作業単位の定義がプラットフォーム仕様と食い違うことがある**という前提で計画フェーズに臨むべき。
- **孤立データの掃除は「消す条件」より「消さない条件」の設計が本体**。ブックマーク同期が未完了な起動直後に素直に突合すると、全別名が孤立判定になり得る。猶予期間（30日）と空ツリーガードという2つの保守的ガードを先に決めたことで、削除ロジック自体は素直に書けた。
- `@extension/shared` は React 依存（hoc/hooks）も再エクスポートするが、`sideEffects: false` によりツリーシェイクされ、SW バンドル（53.9KB）に React は混入しなかった。ワークスペース内パッケージのバレル export は、consumer 側のバンドルを実測で確認すれば過度に恐れなくてよい。

**プロセス上の改善点**:
- 計画フェーズでユーザーから「実害が具体的にイメージできない」という問いを受け、`expandedFolderIds` の実際の書き込み経路（`FolderTree.tsx:141/162`）や `AliasStore.failoverToLocal` による同期停止まで遡って説明した。この掘り下げによって「フォルダIDの残骸」の実害の大小（`expandedFolderIds` は単調増加するが `session.*` はポップアップを開けば自然解消する）が明確になり、要件の粒度が適正化された。**背景セクションに「なぜ困るか」を書く際は、コード上の書き込み/読み出し経路まで特定しておくと計画の精度が上がる。**
- implementation-validator の指摘が両方とも「規約・設計意図との細かなズレ」だった（機能欠陥はゼロ）。計画時に規約（Boolean 命名）を型定義案へ反映しきれていなかったのが原因で、設計書のコード片を書く段階で development-guidelines を突き合わせるべきだった。

### 次回への改善提案
- **U18（release-prep）への申し送り**:
  - Options の「起動ショートカットが未割り当てです」セクションの文言は日本語ベタ書き。i18n 対応時に `_locales` へ移すこと。
  - ストア説明文に「他の拡張機能とキーが競合している場合は `chrome://extensions/shortcuts` で設定してください」の記載を検討すること（実機で実際に発生した事象のため）。
  - `suggested_key` を競合の少ない組み合わせへ変更する案は今回見送った（既存ユーザーの割り当てを壊さない方が優先）。ストア公開前に再検討の余地あり。
- 起動時クリーンアップは実データ規模での実測をしていない（数百件規模で数百ms以内、という成功指標は理論値）。E2E またはリリース前チェックで、大規模ブックマーク環境での起動時間を一度計測しておくとよい。
- `index.ts`（イベント登録）と `SettingsTab.tsx`（案内の表示条件）にはユニットテストがなく、実機確認に依存している。E2E 基盤（`pnpm e2e`）に「ゴミ箱の期限切れが起動時に掃除される」導線を足せると、信頼性周りの回帰を自動で拾える。
