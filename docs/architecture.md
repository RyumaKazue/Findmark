# 技術仕様書 (Architecture Design Document)

- **ドキュメント名**: architecture
- **プロダクト名**: Findmark
- **作成日**: 2026-07-24
- **参照元**: [docs/product-requirements.md](./product-requirements.md), [docs/functional-design.md](./functional-design.md), [docs/design/README.md](./design/README.md)（ポップアップUIデザイン・レイアウトの正）

本書は、PRDの要件と機能設計を技術的に実現するためのシステム構造・技術選定・非機能設計を定義する。ベースはChrome拡張ボイラープレート(chrome-extension-boilerplate-react-vite)で、pnpm workspace + Turborepo のモノレポ構成。**外部通信ゼロ / host permission不要** を全設計の不変条件とする。

---

## テクノロジースタック

### 言語・ランタイム

| 技術 | バージョン | 備考 |
|------|-----------|------|
| Node.js | 22.15.1 (`.nvmrc`) | 開発・ビルド時のみ。実行時はブラウザ |
| TypeScript | 5.8.x | 静的型付けでデータモデル・正規化の正確性を担保 |
| pnpm | 10.11.0 (`packageManager`) | workspace によるモノレポ管理 |
| Chrome Extension | Manifest V3 | Service Worker 型。Web Store の必須要件 |

### フレームワーク・ライブラリ

| 技術 | バージョン | 用途 | 選定理由 |
|------|-----------|------|----------|
| React | 19.1 | Popup / Options のUI | 宣言的UIがモード状態遷移(LIST/EDIT/PANEL/DRAG)の管理に適する。ボイラープレート標準 |
| Vite | 6.3 | ビルド・HMR | 拡張機能向けの高速な開発サイクル。ボイラープレート標準 |
| Turborepo | 2.5 | モノレポのタスク実行 | `packages/` と `pages/` のビルド/型チェック/lintを並列・キャッシュ |
| Tailwind CSS | 3.4 | スタイリング | 800×600px の密なUIをユーティリティで高速構築。ボイラープレート標準 |
| @types/chrome | 0.0.323 | Chrome API 型定義 | `chrome.bookmarks` / `storage` / `tabs` の型安全な利用 |

**新規に追加を検討するライブラリ**(いずれも軽量・オフライン動作が条件):

| 技術 | 用途 | 選定理由 / 判断基準 |
|------|------|----------|
| あいまい検索(例: fuzzysort 等) | 結果0件時のフォールバック | 辞書非同梱・純粋関数・数KB級であること。外部通信・重い依存があれば自前のLevenshteinで代替 |
| 仮想スクロール(例: @tanstack/virtual 等) | 大量結果の描画最適化 | React 19対応・軽量であること。要件を満たせなければ自前実装 |

> **依存追加の原則**: 外部通信を行うもの、巨大な辞書を同梱するものは採用しない。プライバシー方針(データ収集なし)とバンドルサイズを最優先する。

### 開発ツール

| 技術 | バージョン | 用途 |
|------|-----------|------|
| ESLint | 9.27 | 静的解析(typescript-eslint, react-hooks, jsx-a11y, import-x, prettier)。flat config(`eslint.config.ts`) |
| Prettier | 3.5 | フォーマット。Tailwindクラス整列は `prettier-plugin-tailwindcss` が担当 |
| Husky + lint-staged | 9.1 / 16.0 | コミット前の lint/format 自動実行 |
| WebdriverIO(`@wdio/cli`) | — | 拡張機能ロードでのE2E(`tests/e2e`) |
| @extension/i18n | — | `_locales`(ja/en)の型付き参照 |

---

## アーキテクチャパターン

### 全体構造: 実行コンテキスト分離 + 共有ドメインレイヤー

Chrome拡張は複数の実行コンテキスト(Popup / Options / Service Worker)に分かれる。各UIコンテキストは薄く保ち、**ドメインロジックは `packages/` の共有レイヤーに集約**して重複を避ける。

```
┌──────────────────────────────────────────────────────────┐
│  UIレイヤー (React)                                        │
│  ┌─────────────┐  ┌──────────────┐                        │
│  │ pages/popup │  │ pages/options│  ← ユーザー入力・表示   │
│  └─────────────┘  └──────────────┘                        │
├──────────────────────────────────────────────────────────┤
│  サービスレイヤー (packages/shared - ドメインロジック)     │
│  SearchEngine / Normalizer / ImportExportService /        │
│  UndoManager                                              │
├──────────────────────────────────────────────────────────┤
│  データレイヤー (packages/storage - 永続化)               │
│  AliasStore / TrashStore / SettingsStore / LocalStateStore│
│  BookmarkService (chrome.bookmarks / tabs ラッパ)         │
├──────────────────────────────────────────────────────────┤
│  背景 (chrome-extension/src - Service Worker)             │
│  起動時クリーンアップ / コマンドショートカット受信          │
└──────────────────────────────────────────────────────────┘
```

**依存方向**: UI → サービス → データ の一方向。UIがChrome APIを直接叩かず、必ずデータレイヤー経由にする(テスト容易性とモック差し替えのため)。

#### UIレイヤー(`pages/popup`, `pages/options`)
- **責務**: 入力受付、モード状態遷移、バリデーション表示、結果描画。
- **許可**: サービス/データレイヤーの関数呼び出し。
- **禁止**: `chrome.bookmarks` / `chrome.storage` を直接呼ぶこと。

#### サービスレイヤー(`packages/shared`)
- **責務**: 検索・正規化・インポートエクスポート・アンドゥ管理などのビジネスロジック。
- **許可**: データレイヤーの呼び出し。
- **禁止**: Reactやブラウザ描画への依存(純粋なTypeScriptとして単体テスト可能に保つ)。

#### データレイヤー(`packages/storage`)
- **責務**: `chrome.storage`(sync/local)と `chrome.bookmarks` の抽象化、チャンク分割、フォールバック。
- **許可**: Chrome API アクセス。
- **禁止**: 検索・整理などのビジネスロジックの実装。

#### 背景(Service Worker)
- **責務**: ブラウザ起動時の掃除(存在しないフォルダID/別名参照のクリーンアップ)、`chrome.commands` のショートカット受信。
- MV3のため常駐しない。重い処理は持たせず、UIコンテキスト主体とする。

---

## データ永続化戦略

### ストレージ方式

| データ種別 | ストレージ | フォーマット | 理由 |
|-----------|----------|-------------|------|
| ブックマーク本体 | `chrome.bookmarks`(Chrome管理) | ツリー | single source of truth。独自コピーを持たない |
| 別名(AliasRecord) | `chrome.storage.sync` | チャンク分割(`alias_chunk_N`) | 別PC自動同期。URLハッシュ紐付けで移行に強い |
| 別名(容量超過時) | `chrome.storage.local` | 同上 | sync の 8KB/512アイテム制限を超えたらフォールバック |
| ゴミ箱(TrashItem) | `chrome.storage.local` | 配列 | 端末固有。容量が大きく sync 不適 |
| フォルダ展開状態 | `chrome.storage.local` | ID配列 | 端末固有ID。sync すると別PCで壊れる |
| 前回使用フォルダ | `chrome.storage.local` | ID | 端末固有 |
| ユーザー設定 | `chrome.storage.sync` | オブジェクト | 端末間で共通化したい |

**別名のチャンク設計(要点)**: `chrome.storage.sync` は「1アイテム8KB / 最大512アイテム」制限があり、ブックマーク1件=1キーだと512件で破綻する。AliasRecordを100件ずつまとめ、`alias_index` に逆引き(`urlHash → chunk番号`)と `storageMode` を持つ。書き込みは該当チャンクのみ更新する。

**紐付けキーの原則**: 別名は **ブックマークIDではなくURL正規化ハッシュ** で紐付ける。IDは端末・アカウントで変わるため、IDキーだと同期・インポートで別名が全て外れる。

### バックアップ戦略

拡張機能の性質上、自動的な世代バックアップは持たず、**多層の消失防止**で担保する。

- **即時アンドゥ**: 削除・移動・一括操作を5秒間メモリ保持し、トーストから取り消し可能。
- **ゴミ箱**: 削除データを30日間(設定可)`storage.local` に保持。フォルダは配下ツリーごと保存し、復元時は `ensureFolderPath` で階層を再作成。
- **ユーザー主導のエクスポート**: 独自JSON(別名含む)/ 標準HTMLでのエクスポートを移行・バックアップ手段として提供。
- **sync同期**: 別名・設定は Chrome アカウント同期により実質的に別PCへ複製される。

---

## パフォーマンス要件

### レスポンスタイム

| 操作 | 目標時間 | 測定方法 |
|------|---------|---------|
| ポップアップ起動 → 検索ボックスフォーカス | 200ms以内 | `performance.now()` で起動〜フォーカスを計測 |
| インクリメンタル検索(1文字あたり再描画) | 100ms以内 / 1,000件 | 1,000件のダミーで入力ごとの再描画を計測 |
| ブックマークを開く(Enter) | 体感即時 | `chrome.tabs.update` 呼び出しまで |
| 別名保存(upsert) | 100ms以内 | 該当チャンクのみ書き込みを計測 |

### リソース使用量

| リソース | 目標値 | 測定/根拠 |
|---------|------|------|
| メモリ | ポップアップ表示中 80MB 以下 | Chrome DevTools Memory タブで数千件データ読込後を計測 |
| バンドルサイズ(Popup) | gzip後 300KB 以下 | `pnpm build` 後の `dist/popup` サイズをCIで計測、閾値超過で警告(辞書非同梱を維持) |
| storage.sync 使用量 | 512アイテム / 各8KB 未満(全体 約100KB) | 制限内をチャンクで管理、超過は local へ退避 |
| storage.local 使用量 | 既定上限 約10MB 未満 | ゴミ箱の件数上限(例500件)・容量上限はこの枠から逆算する |

**最適化方針**: 起動時の `getTree()` / `getAll()` 先読み、正規化済み文字列のメモ化、検索結果の仮想スクロール、別名チャンクの遅延読み込み。

---

## セキュリティアーキテクチャ

### データ保護

- **外部送信ゼロ**: fetch/XHR/WebSocket を一切使用しない。テレメトリも持たない。「データ収集なし」を技術的に保証。
- **最小権限**: `permissions` は `bookmarks` / `storage` / `activeTab` / `favicon` の4つのみ。`host_permissions` は要求しない。`favicon` 権限の警告表示有無は申請前に現行ドキュメントで確認する。
- **CSP**: MV3デフォルトの厳格なCSPを維持し、外部スクリプト・リソースを読み込まない。
- **フォント同梱**: デザイン指定フォント `Noto Sans JP`（400/500/700）/ `IBM Plex Mono`（400/500）は **woff2 を拡張にバンドルし `@font-face` で適用**する。Google Fonts 等の **CDN 参照は禁止**（CSP・外部通信ゼロ・オフライン動作のため）。レイアウト・トークン・寸法は `docs/design/` を正とする（[functional-design.md](./functional-design.md)「UI設計」）。
- **ファビコン**: `chrome-extension://<runtime.id>/_favicon/?pageUrl=...`（`favicon` 権限）のみを使用し、外部 `https://<host>/favicon.ico` の取得は行わない（外部通信ゼロ）。取得失敗時は頭文字アバターにフォールバックする（`docs/design/` 準拠）。
- **機密情報**: 認証情報・APIキーを持たない(外部サービス連携がないため)。

### 入力検証

- **URL**: 編集・登録・インポート時に `new URL()` でパースし、`javascript:` 等の危険スキームを拒否。不正時は確定不可 + インラインエラー。
- **別名**: 正規化後に重複排除、1件20個・各50文字の上限を検証。空白のみは無視。
- **インポート**: JSON/HTML を構造検証し、独自JSONは `format` / `version` を確認。想定外はエラー表示して部分適用しない。`version` に応じてマイグレーション。

### エラーハンドリング

- ブックマークAPI失敗時は操作をロールバックし、トーストで通知。
- sync容量超過は例外扱いにせず local へ自動フォールバックし、ユーザーに切替を通知。

---

## スケーラビリティ設計

### データ増加への対応

- **想定データ量**: ブックマーク数千件、別名数千件規模。
- **検索**: 仮想スクロールで描画コストを表示行数に固定。正規化のメモ化で入力ごとの再計算を回避。
- **別名ストレージ**: チャンク分割により512アイテム制限を回避。逆引きインデックスで対象チャンクのみ読み書き。
- **ゴミ箱**: 件数上限(例500件)/容量上限を設け、超過分を古い順に自動削除(`enforceLimits`)。30日経過分は `purgeExpired`。

### 機能拡張性

- **共有レイヤー分離**: ドメインロジックを `packages/shared` に集約しているため、Post-MVP機能(未ヒット時の別名提案、frecencyソート、タグ、オムニボックス連携)を既存UIに影響少なく追加できる。
- **設定のカスタマイズ**: `UserSettings`(ゴミ箱保持日数・locale など)で拡張。
- **フォーマット互換**: 独自JSONの `version` によりフォーマット変更後も後方互換を維持。

---

## テスト戦略

### ユニットテスト
- **対象**: Normalizer(NFKC/カナ統一/URL正規化)、SearchEngine(AND部分一致・matchedAlias・scope除外・フォールバック)、AliasStore(チャンク境界・上限・フォールバック)、ImportExportService(重複解決3系統・version移行)。
- **方針**: サービス/データレイヤーはChrome APIをモックして純粋にテスト可能に保つ。
- **カバレッジ目標**: ドメインロジック(shared/storage)で80%以上。

### 統合テスト
- **対象**: 別名付与 → 検索ヒット → ハイライト、移動/削除 → アンドゥ → 復元、数千件でのレイテンシ。

### E2Eテスト
- **ツール**: ボイラープレート同梱のE2E基盤(拡張機能ロード)。
- **シナリオ**: 起動→検索→Enterで開く / ドラッグ&ドロップ移動 / Optionsで独自JSONエクスポート→別プロファイルでインポート→別名維持 / ゴミ箱からフォルダごと復元。

---

## 技術的制約

### 環境要件
- **ブラウザ**: Chrome(Manifest V3対応版)。Firefox は browser_specific_settings で対応余地を残すが、`favicon` 権限・sidePanel差異に注意(MVPはChrome優先)。
- **ポップアップ寸法**: 760×560px 固定（Chrome popup 上限 800×600 に収まる）。レイアウト・トークンは `docs/design/` を正とする。
- **開発環境**: Node.js 22.15.1、pnpm 10.11.0。
- **外部依存**: なし(外部API・サーバー不要)。

### パフォーマンス制約
- ポップアップはフォーカスを失うと即座に閉じる。長時間処理・モーダル確定型UIを持てない → 即時保存 + アンドゥで統一。
- ファイルダイアログを開くとポップアップが閉じる → インポート/エクスポートはOptionsページに配置。

### セキュリティ制約
- 外部通信禁止(自己制約)。host permission を追加しない。
- `chrome.storage.sync` の容量上限(8KB/アイテム・512アイテム・全体約100KB)を超えない設計を維持。

> **⚠️ 現状ギャップ(実装着手時の必須対応)**: 現行の `chrome-extension/manifest.ts` はボイラープレートの初期状態であり、本書が掲げる「最小権限・host permission不要」をまだ満たしていない。実装着手前に以下を必須タスクとする:
> 1. `permissions` に `bookmarks` / `activeTab` / `favicon` を追加する(現状は `['storage']` のみ)
> 2. `content_scripts` ブロック(`<all_urls>` マッチ)を削除する(Findmarkはコンテンツスクリプトを使わない。残すと「すべてのサイトのデータ読み取り/変更」相当の警告対象になり得る)
> 3. `web_accessible_resources` を `_favicon/*` 等の必要最小限に絞る(現状は `*://*/*` へ広範公開)
> 4. 不要な `devtools_page` などボイラープレート由来のエントリを整理する

---

## 依存関係管理

| ライブラリ | 用途 | バージョン管理方針 |
|-----------|------|-------------------|
| react / react-dom | UI | `^`(マイナーまで許可) |
| tailwindcss | スタイル | `^` |
| vite / turbo | ビルド | `^` |
| typescript | 型 | `^`(ボイラープレート準拠) |
| @types/chrome | Chrome型 | `^`(APIパッチ追従) |
| あいまい検索/仮想スクロール(採用時) | 検索・描画 | 導入時に評価。破壊的変更リスクがあれば固定 |

**方針**:
- ボイラープレートの既存バージョン方針(`^`)を踏襲。
- 新規依存は「オフライン動作・軽量・保守されている」ことを必須条件に評価してから追加する。
- `pnpm-lock.yaml` で厳密固定し、`--frozen-lockfile` でCI再現性を担保。
