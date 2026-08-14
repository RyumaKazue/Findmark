# 要求内容

- **作業単位**: U16 `trash`（MVP機能12「ゴミ箱(削除データの保持・復元)」）
- **依存**: U4 bookmark-service / U5 alias-store / U10 inline-edit-delete-undo（いずれも ✅ 完了）
- **指示元**: [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) 「作業単位一覧」U16 行

## 概要

削除したブックマークを `chrome.storage.local` に30日間（設定可）保持する **第2層の防御（ゴミ箱）** を導入し、オプションページの「ゴミ箱」タブから元のフォルダパスへ復元できるようにする。あわせて Options に**タブ切り替え機構**と「設定」タブ（ゴミ箱保持日数・locale）を導入する。

## 背景

U10 で「即時アンドゥ（5秒・メモリ）」＝第1層は実装済みだが、トーストが消えた後の誤削除は取り返せない。PRD 機能12・architecture.md「バックアップ戦略」は **即時アンドゥ + 30日ゴミ箱の二重防御**でデータ損失ゼロを担保する設計であり、その第2層が未実装のまま残っている。

`useRowActions.deleteRow`（U10）には「※U16（ゴミ箱）はこの直後に `TrashStore.push(...)` を差し込むだけで2層防御になる」という接続点のコメントが既に置かれている（[useRowActions.ts:96](../../pages/popup/src/hooks/useRowActions.ts)）。本単位はその接続点を実装する。

また Options は U15 時点で `ImportExportTab` 単体だったため、タブ切り替えを意図的に見送っている（[Options.tsx](../../pages/options/src/Options.tsx) のコメント）。本単位でタブ機構を導入する（mvp-development-flow U16 行に明記）。

## 実装対象の機能

### 1. TrashStore（データレイヤー）

- `chrome.storage.local` のキー `trash` に `TrashItem[]` を保持する（functional-design「ファイル構造(ストレージ上のキー設計)」）。
- `push` / `list` / `restore` / `purgeExpired` / `enforceLimits` を提供する（functional-design「TrashStore(ゴミ箱)」）。
- 保存対象は **URL・タイトル・元フォルダパス・別名・削除日時**。フォルダは `children` で配下ツリーごと1件として保持する。
- 復元は `BookmarkService.ensureFolderPath` で元パスを再作成し、ブックマーク再作成 + 別名の再登録を行う。
- 件数上限・容量上限を超えたら**古い順に自動削除**する。

### 2. 削除フローへのゴミ箱接続（Popup）

- 単一削除（`useRowActions.deleteRow`）・一括削除（`bulkActionsCore.deleteRowsCore`）の成功後に `TrashStore.push` する。
- **即時アンドゥ（第1層）で復元した場合は、対応するゴミ箱項目を取り消す**（復元済みなのにゴミ箱にも残ると、後からゴミ箱復元して重複が生まれるため）。
- ゴミ箱への退避に失敗しても削除操作自体は成功として続行する（ログのみ・UI と実データの乖離を作らない）。

### 3. Options のタブ機構 + TrashTab + SettingsTab

- Options にタブ切り替え（インポート/エクスポート・ゴミ箱・設定）を導入する。
- **TrashTab**: ゴミ箱一覧（タイトル・URL・元パス・別名・削除日時）、復元、個別の完全削除、空にする。開いた時点で保持期間切れを自動 purge する。
- **SettingsTab**: ゴミ箱保持日数（`UserSettings.trashRetentionDays`）と locale（ja/en）を `settingsStore` 経由で保存する。

## 受け入れ条件

> mvp-development-flow.md U16 行「受け入れ基準」を写し取り、検証可能な粒度へ分解したもの。

### AC-1: 削除が即時アンドゥ + 30日ゴミ箱の2層になっている（PRD 機能12 / architecture「バックアップ戦略」）
- [ ] 単一削除の成功後に `TrashStore.push` が呼ばれ、`trash` に URL・タイトル・元フォルダパス・別名・削除日時が保存される
- [ ] 一括削除でも成功した各件がゴミ箱へ入る
- [ ] 即時アンドゥ（5秒トースト）で戻した場合、対応するゴミ箱項目が取り消される（ゴミ箱に残らない）
- [ ] ゴミ箱への退避に失敗しても削除操作は成功扱いで続行する（コンソールにエラーを残す）

### AC-2: 元パスへ復元できる。無ければ再作成する（PRD 機能12）
- [ ] `restore(id)` が `ensureFolderPath(folderPath)` で復元先を解決し、フォルダが存在しなければ自動作成する
- [ ] ブックマークが再作成され、削除時点の別名が `AliasStore.upsert` で復帰する
- [ ] `kind: 'folder'` の項目は配下ツリーごと復元される（子フォルダ・子ブックマーク・その別名を含む）
- [ ] 復元に成功した項目はゴミ箱から取り除かれる。失敗時はゴミ箱に残る

### AC-3: 上限超過で古い順に退避（architecture「スケーラビリティ設計」）
- [ ] 件数上限（500件）を超えると、削除日時が古い項目から自動的に取り除かれる
- [ ] 容量上限（4MB）を超えると、同様に古い項目から取り除かれる
- [ ] `purgeExpired(retentionDays)` が保持日数を過ぎた項目のみを削除する（境界: ちょうど N 日は残す）

### AC-4: ゴミ箱UIはオプションページの「ゴミ箱」タブ（PRD 機能12）
- [ ] Options に3タブ（インポート/エクスポート・ゴミ箱・設定）が並び、切り替えできる
- [ ] TrashTab が一覧（タイトル・URL・元パス・別名・削除日時）を新しい順で表示する
- [ ] 復元ボタンで実ブックマークが復元され、一覧から消える
- [ ] タブを開いた時点で保持期間切れの項目が自動 purge される
- [ ] ポップアップ側にゴミ箱UIを持たない（即時アンドゥのみ）

### AC-5: 設定（保持日数・locale）
- [ ] SettingsTab で保持日数を変更でき、`chrome.storage.sync` の `user_settings` に保存される
- [ ] 変更した保持日数が TrashTab の purge に反映される
- [ ] locale（ja/en）を選択・保存できる

### AC-6: 品質ゲート
- [ ] `pnpm test` / `pnpm lint` / `pnpm type-check` がすべて成功する
- [ ] `trashStore.ts` のユニットテストカバレッジが 80% 以上（development-guidelines「テスト戦略」）

## 成功指標

- 誤削除からの復旧手段が2層（5秒アンドゥ / 30日ゴミ箱）そろい、PRD 非機能要件「削除・移動を含む全操作でデータ損失ゼロ」を満たす。
- ゴミ箱が `storage.local` 既定上限（約10MB）を圧迫しない（件数500件・容量4MB の二重上限）。

## スコープ外

以下はこのフェーズでは実装しません:

- **フォルダ削除UI**: 現状フォルダを削除する導線が Popup に無い。`TrashStore` は `kind: 'folder'`（`children` 付き）の保存・復元に対応させるが、それを生成する UI は本単位では追加しない（PRD/機能設計にフォルダ削除の UI 要件が無いため）。
- **起動時の自動クリーンアップ**: Service Worker 起動時の孤立参照掃除・定期 purge は U17（service-worker）の担当。本単位では TrashTab を開いた時点で purge する。
- **locale の実適用**: SettingsTab は `UserSettings.locale` の保存までを行う。UI 文言の i18n 適用は U18（release-prep）。
- **ゴミ箱データのエクスポート**: PRD「未解決事項」の検討項目であり MVP スコープ外。
- **ゴミ箱の検索・絞り込み**: PRD に要件が無い。

## 参照ドキュメント

- [docs/product-requirements.md](../../docs/product-requirements.md) — 機能12「ゴミ箱(削除データの保持・復元)」
- [docs/functional-design.md](../../docs/functional-design.md) — エンティティ `TrashItem` / `TrashStore(ゴミ箱)` / UC-5「削除 → ゴミ箱 → 復元」/ ファイル構造（`trash` キー）
- [docs/architecture.md](../../docs/architecture.md) — 「バックアップ戦略」「スケーラビリティ設計」「データストア選定」
- [docs/repository-structure.md](../../docs/repository-structure.md) — `pages/options/src/components/TrashTab.tsx` / `SettingsTab.tsx`、`packages/storage/lib/impl/trashStore.ts`
- [docs/development-guidelines.md](../../docs/development-guidelines.md) — レイヤー依存（UI→サービス→データ）・エラーハンドリング・テスト戦略
