# リポジトリ構造定義書 (Repository Structure Document)

- **ドキュメント名**: repository-structure
- **プロダクト名**: Findmark
- **作成日**: 2026-07-24
- **参照元**: [architecture.md](./architecture.md), [functional-design.md](./functional-design.md)

本書は、Findmark のディレクトリ構造とファイル配置規則を定義する。ベースは chrome-extension-boilerplate-react-vite(pnpm workspace + Turborepo モノレポ)であり、その構造を尊重しつつ Findmark 固有コードの配置先を明確にする。

---

## プロジェクト構造(全体)

```
Findmark/
├── chrome-extension/          # 拡張機能のコア(manifest, Service Worker)
│   ├── manifest.ts            # Manifest V3 定義(権限/エントリ)
│   ├── src/background/        # Service Worker(起動時掃除, commands受信)
│   ├── public/                # アイコン等の静的アセット
│   └── vite.config.mts
│
├── pages/                     # 各UIコンテキスト(React)
│   ├── popup/                 # ★検索ポップアップ(メインUI)
│   ├── options/               # ★オプション(インポート/エクスポート, ゴミ箱, 設定)
│   ├── content-runtime/       # (ボイラープレート由来。MVPでは未使用想定)
│   ├── devtools/              # (同上)
│   └── devtools-panel/        # (同上)
│
├── packages/                  # 共有パッケージ(ワークスペース)
│   ├── shared/                # ★サービスレイヤー(検索/正規化/import-export/undo)
│   ├── storage/               # ★データレイヤー(alias/trash/bookmark/settings)
│   ├── i18n/                  # _locales(ja/en)の型付き参照
│   ├── ui/                    # 共有UIコンポーネント
│   ├── env/                   # 環境変数
│   ├── hmr/ dev-utils/ vite-config/ tsconfig/ tailwindcss-config/  # ビルド基盤
│   ├── module-manager/        # ページの有効/無効管理
│   └── zipper/                # ストア提出用zip生成
│
├── tests/                     # E2E等の横断テスト(boilerplate同梱基盤)
├── docs/                      # 永続ドキュメント(本書を含む6点 + ideas/)
├── bash-scripts/              # env/version補助スクリプト
├── dist/                      # ビルド成果物(gitignore)
├── package.json               # ルート(scripts, 依存)
├── pnpm-workspace.yaml        # ワークスペース定義
└── turbo.json                 # タスクパイプライン
```

★ = Findmark で主に実装・改修するディレクトリ。

---

## ディレクトリ詳細

### chrome-extension/ (拡張コア)

**役割**: Manifest定義と背景処理。UIを持たない。

**配置ファイル**:
- `manifest.ts`(想定・**現状はボイラープレート初期状態**): 目標は 権限(`bookmarks`/`storage`/`activeTab`/`favicon`)、`action.default_popup`、`options_page`、`commands`(キーボードショートカット)、`_favicon` の web_accessible_resources を定義。現状は `permissions: ['storage']` のみで、不要な `content_scripts`(`<all_urls>`)・`devtools_page` が残存する。整理タスクは architecture.md「セキュリティ制約」の現状ギャップを参照。
- `utils/plugins/make-manifest-plugin.ts`: `manifest.ts` をビルド時に `manifest.js` へ変換する Vite プラグイン。
- `src/background/index.ts`: Service Worker。起動時のクリーンアップ(存在しないフォルダID・別名参照の掃除)、`chrome.commands` 受信。

**依存関係**:
- 依存可能: `packages/storage`, `packages/shared`, `packages/i18n`
- 依存禁止: `pages/*`(UIに依存しない)

### pages/popup/ (検索ポップアップ・メインUI)

**役割**: 検索ファーストのメインUI。モード状態遷移(LIST/INLINE_EDIT/ALIAS_EDIT/PANEL/DRAG)の中心。

**配置ファイル(想定構成)**:
```
pages/popup/src/
├── index.tsx                  # エントリ
├── Popup.tsx                  # ルート(モード状態機械を保持)
├── components/                # UIコンポーネント(PascalCase)
│   ├── SearchBox.tsx          # 検索ボックス + フォルダチップ
│   ├── FolderTree.tsx         # 左ペイン(220px)
│   ├── ResultList.tsx         # 右ペイン(仮想スクロール)
│   ├── ResultRow.tsx          # 1行(ファビコン/別名チップ/操作)
│   ├── AliasEditor.tsx        # 別名チップ編集
│   ├── InlineEdit.tsx         # タイトル/URLインライン編集
│   ├── MovePanel.tsx          # Ctrl+M フォルダ選択パネル
│   ├── AddCurrentPanel.tsx    # 現在ページ登録パネル
│   ├── Favicon.tsx            # ファビコン + 頭文字アバター
│   └── Toast.tsx              # アンドゥトースト
├── hooks/                     # React hooks(useXxx)
│   ├── useSearch.ts           # SearchEngine 呼び出し + 状態
│   ├── useMode.ts             # モード状態遷移
│   ├── useSelection.ts        # 複数選択
│   ├── useDragAndDrop.ts      # ドラッグ移動
│   └── useUndo.ts             # 即時アンドゥ
└── Popup.css / index.css
```

**命名規則**: コンポーネントは PascalCase(`.tsx`)、hooks は `useXxx.ts`。

**依存関係**:
- 依存可能: `packages/shared`, `packages/storage`, `packages/ui`, `packages/i18n`
- 依存禁止: `chrome.bookmarks` / `chrome.storage` の直接呼び出し(必ず `packages/storage` 経由)

### pages/options/ (オプションページ)

**役割**: ポップアップに置けない機能。インポート/エクスポート(ファイルダイアログ)、ゴミ箱、設定。

**配置ファイル(想定構成)**:
```
pages/options/src/
├── Options.tsx
├── components/
│   ├── ImportExportTab.tsx    # 独自JSON / 標準HTML の入出力
│   ├── ConflictDialog.tsx     # 独自JSONインポートの重複解決
│   ├── TrashTab.tsx           # ゴミ箱一覧・復元
│   └── SettingsTab.tsx        # ゴミ箱保持日数・locale
└── hooks/
```

**依存関係**: popup と同じ(サービス/データレイヤー経由)。

### packages/shared/ (サービスレイヤー)

**役割**: ブラウザ描画・React に依存しない純粋なドメインロジック。単体テスト可能に保つ。

**配置ファイル(想定・既存 `lib/` 配下に追加)**:
```
packages/shared/lib/
├── search/
│   ├── SearchEngine.ts        # AND部分一致・スコアリング・フォールバック
│   └── Normalizer.ts          # NFKC/カナ統一/URL正規化・ハッシュ
├── import-export/
│   ├── ImportExportService.ts
│   ├── jsonFormat.ts          # 独自JSON(format/version)スキーマ・マイグレーション
│   └── htmlFormat.ts          # Netscape Bookmark File 入出力
├── undo/
│   └── UndoManager.ts
├── types/                     # ドメイン型(AliasRecord, TrashItem, SearchResultItem 等)
└── index.ts
```

**命名規則**: クラス/サービスは PascalCase、純粋関数モジュールは camelCase。

**依存関係**:
- 依存可能: `packages/storage`(データ取得)
- 依存禁止: `pages/*`, React, DOM API

### packages/storage/ (データレイヤー)

**役割**: `chrome.storage` / `chrome.bookmarks` の抽象化。チャンク分割・フォールバックを内包。

**配置ファイル(想定・既存 `base/` `impl/` を踏襲)**:
```
packages/storage/lib/
├── impl/
│   ├── aliasStore.ts          # AliasStore(alias_chunk_N, alias_index)
│   ├── trashStore.ts          # TrashStore
│   ├── bookmarkService.ts     # chrome.bookmarks / tabs ラッパ
│   ├── settingsStore.ts       # UserSettings(sync)
│   └── localStateStore.ts     # 展開状態・前回フォルダ(local)
├── base/                      # createStorage 等の基盤(既存)
├── types.ts
└── index.ts
```

**依存関係**:
- 依存可能: Chrome API(`chrome.storage`, `chrome.bookmarks`, `chrome.tabs`)
- 依存禁止: `packages/shared`, `pages/*`(ビジネスロジックを持たない)

### docs/ (ドキュメント)

**配置ドキュメント**:
- `product-requirements.md` / `functional-design.md` / `architecture.md` / `repository-structure.md`(本書) / `development-guidelines.md` / `glossary.md`
- `ideas/initial-requirements.md`: 初期要件(壁打ち成果物)

---

## ファイル配置規則

### ソースファイル

| ファイル種別 | 配置先 | 命名規則 | 例 |
|------------|--------|---------|-----|
| Reactコンポーネント | `pages/*/src/components/` | PascalCase.tsx | `ResultRow.tsx` |
| React hooks | `pages/*/src/hooks/` | useXxx.ts | `useSearch.ts` |
| ドメインサービス | `packages/shared/lib/**/` | PascalCase.ts | `SearchEngine.ts` |
| 純粋関数/スキーマ | `packages/shared/lib/**/` | camelCase.ts | `jsonFormat.ts` |
| ストレージ実装 | `packages/storage/lib/impl/` | camelCase.ts | `aliasStore.ts` |
| ドメイン型 | `packages/shared/lib/types/` | camelCase.ts | `alias.ts` |
| 背景処理 | `chrome-extension/src/background/` | camelCase.ts | `index.ts` |

### テストファイル

| テスト種別 | 配置先 | 命名規則 | 例 |
|-----------|--------|---------|-----|
| ユニットテスト | 対象ファイルと同階層(co-located) | `[対象].test.ts` | `SearchEngine.test.ts` |
| 統合テスト | `tests/integration/` | `[機能].test.ts` | `alias-search.test.ts` |
| E2Eテスト | `tests/e2e/` | `[シナリオ].test.ts` | `popup-search.test.ts` |

> ユニットテストは boilerplate 慣習に合わせ、対象と同階層への co-location を基本とする。

> **⚠️ テスト基盤は現状未整備(実装着手時の必須対応)**: 上記のテスト配置は目標構成であり、現状のツールチェーンでは実行手段がない。以下を整備タスクとする:
> - `packages/shared` / `packages/storage` に vitest を追加し、各 `package.json` に `"test": "vitest run"` を追加する(現状 `test` スクリプトは `chrome-extension` のみ)
> - `turbo.json` に `test` パイプライン(依存関係付き)を追加する(現状 build/dev/lint/type-check/e2e のみ)
> - CI(`.github/workflows/`)にテスト実行ステップを追加する
> - `tests/integration/` を新設する場合、`pnpm-workspace.yaml` の `tests/*` パターンに従い独立パッケージ化するか、`tests/e2e` 配下に統合するかを決める
> - E2Eの命名は既存の `tests/e2e/specs/page-*.test.ts`(ページ単位)に合わせるか、`[シナリオ].test.ts` を新設するか方針を統一する

### 設定ファイル

| ファイル種別 | 配置先 | 命名規則 |
|------------|--------|---------|
| Manifest | `chrome-extension/manifest.ts` | 固定 |
| ツール設定 | プロジェクトルート | `eslint.config.ts`, `.prettierrc`, `turbo.json` |
| 各ページのVite設定 | 各 `pages/*/` | `vite.config.mts` |
| 各ページのTailwind設定 | 各 `pages/*/` | `tailwind.config.ts` |
| 共有tsconfig | `packages/tsconfig/` | — |

---

## 命名規則

### ディレクトリ名
- レイヤー/複数要素をまとめるもの: 複数形または機能名の kebab-case(`components/`, `hooks/`, `import-export/`)

### ファイル名
- クラス/Reactコンポーネント: PascalCase(`SearchEngine.ts`, `ResultRow.tsx`)
- 関数・ストレージ実装モジュール: camelCase(`aliasStore.ts`, `jsonFormat.ts`)
- 定数モジュール: UPPER_SNAKE_CASE(`STORAGE_KEYS.ts`, `ERROR_MESSAGES.ts`)

### テストファイル名
- パターン: `[対象].test.ts` / `.test.tsx`

---

## 依存関係のルール

### レイヤー間の依存

```
pages/* (UI)
    ↓ (OK)
packages/shared (サービス)
    ↓ (OK)
packages/storage (データ) → Chrome API
```

**禁止される依存**:
- `packages/storage` → `packages/shared`(❌)
- `packages/storage` → `pages/*`(❌)
- `packages/shared` → `pages/*` / React / DOM(❌)
- `pages/*` から `chrome.*` API の直接呼び出し(❌ 必ず storage 経由)

### 循環依存の禁止
共有の型・定数は `packages/shared/lib/types/` または専用モジュールに抽出し、双方向 import を避ける。

---

## スケーリング戦略

### 機能の追加(Post-MVP)
- **小規模**(未ヒット時の別名提案など): 既存の `search/` + popup コンポーネントに追加。
- **中規模**(frecencyソート・タグ): `packages/shared/lib/` にサブディレクトリ(`ranking/`, `tags/`)を新設。
- **大規模**(オムニボービス連携・サイドパネル): `pages/` に新コンテキストを追加し、`packages/module-manager` で有効化制御。

### ファイルサイズの管理
- 1ファイル300行以下を推奨。300–500行でリファクタリング検討、500行以上は分割を強く推奨。
- 例: `SearchEngine.ts`(照合)/ `Normalizer.ts`(正規化)/ スコアリングは必要なら `scoring.ts` に分離。

---

## 特殊ディレクトリ

### .steering/(ステアリングファイル)
**役割**: 個別開発作業の「今回何をするか」を定義。
```
.steering/
└── YYYYMMDD-task-name/
    ├── requirements.md
    ├── design.md
    └── tasklist.md
```

### .claude/(Claude Code設定)
```
.claude/
├── commands/    # スラッシュコマンド(setup-project 等)
├── skills/      # ドキュメント作成スキル群
└── agents/      # サブエージェント定義
```

---

## 除外設定

### .gitignore(実ファイル準拠・現状)
- `**/node_modules`, `**/coverage`
- `**/dist`, `**/build`, `**/dist-zip`, `chrome-extension/manifest.js`, `*.tsbuildinfo`
- `**/.env`, `**/.env.*`(`.example.env` はコミット対象)
- `.DS_Store`, `.idea`, `**/.turbo`, `**/tailwind-output.css`

> **TODO(未対応)**: `.steering/` は現状 `.gitignore` に含まれていない。本書で「特殊ディレクトリ」として使う前提のため、ステアリング運用を始める前に `.gitignore` へ追加が必要(現状はコミット対象になる)。

### .prettierignore(実ファイル準拠・現状)
- `dist`, `*.md`(Markdown はフォーマット対象外 = `docs/` 配下は手動整形)

> ESLint の除外は旧来の `.eslintignore` ではなく flat config(`eslint.config.ts`)の `ignores` で管理される。
