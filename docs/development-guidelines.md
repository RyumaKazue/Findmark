# 開発ガイドライン (Development Guidelines)

- **ドキュメント名**: development-guidelines
- **プロダクト名**: Findmark
- **作成日**: 2026-07-24
- **参照元**: [architecture.md](./architecture.md), [repository-structure.md](./repository-structure.md)

本書は Findmark のコーディング規約と開発プロセスを定義する。ベースはボイラープレート同梱の ESLint / Prettier / Husky / GitHub Actions であり、その設定を正とする(本書と設定が食い違う場合は設定ファイルを優先し、本書を更新する)。

---

## コーディング規約

### 命名規則

#### 変数・関数
```typescript
// ✅ 良い例
const matchedAliases = engine.search(query);
function normalizeText(input: string): string { }

// ❌ 悪い例
const data = search();
function norm(s: any): string { }
```
**原則**:
- 変数: camelCase、名詞句
- 関数: camelCase、動詞始まり
- 定数: UPPER_SNAKE_CASE(`STORAGE_KEYS`, `MAX_ALIASES`)
- Boolean: `is` / `has` / `should` 始まり(`isFolder`, `hasAlias`)

#### クラス・型・コンポーネント
```typescript
class SearchEngine { }              // クラス: PascalCase
interface AliasRecord { }           // インターフェース: PascalCase(I接頭辞は付けない)
type SearchMode = 'LIST' | 'INLINE_EDIT' | 'ALIAS_EDIT' | 'DRAG' | 'PANEL';
const ResultRow = () => { };        // Reactコンポーネント: PascalCase
```

**ファイル名**: クラス/コンポーネントは PascalCase(`SearchEngine.ts`, `ResultRow.tsx`)、純粋関数/ストレージ実装は camelCase(`normalizeUrl.ts`, `aliasStore.ts`)。詳細は [repository-structure.md](./repository-structure.md) 参照。

### コードフォーマット

**Prettier / ESLint に一任する**(手動整形しない)。主要設定(`.prettierrc` 実ファイル準拠):
- インデント: 2スペース(Prettierデフォルト)
- セミコロン: あり(`semi: true`)
- クォート: シングル(`singleQuote: true`)
- 行幅: 120文字(`printWidth: 120`)
- 末尾カンマ: 常に付与(`trailingComma: all`)
- アロー関数の引数括弧: 省略可能なら省略(`arrowParens: avoid`)
- `prettier-plugin-tailwindcss` により Tailwind クラスを自動整列

ESLint(flat config `eslint.config.ts`)は `typescript-eslint` / `react-hooks` / `jsx-a11y` / `import-x` / `prettier` を有効化。**Tailwind クラスの整列は Prettier 側の `prettier-plugin-tailwindcss` が担う**(`eslint-plugin-tailwindcss` は devDependencies に含まれるが `eslint.config.ts` では未使用)。`pnpm lint` / `pnpm lint:fix` / `pnpm format` で実行。

### 型の方針
- `any` を避け、`unknown` + 絞り込みを使う。Chrome API の戻り値は `@types/chrome` の型に従う。
- ドメイン型(`AliasRecord`, `SearchResultItem`, `TrashItem` 等)は `packages/shared/lib/types/` に定義し、UI・データ両レイヤーから共有する。
- 文字列リテラルのユニオン型でモードやステータスを表現する(`SearchMode` 等)。

### コメント規約
```typescript
/**
 * URLを正規化ハッシュに変換する。
 * ブックマークIDは端末/アカウントで変わるため、別名の紐付けキーにはURLハッシュを使う。
 *
 * @param url - 対象URL
 * @returns 正規化後のハッシュ文字列
 */
function hashUrl(url: string): string { }

// ✅ なぜそうするかを説明(何をするかはコードで分かる)
// sync は 8KB/512アイテム制限があるため、100件ずつチャンク化して1キーに収める
await writeChunk(chunkNo, chunk);
```

### エラーハンドリング
- 予期されるエラーは専用クラスを定義し、UIで種別に応じて表示する。
- Chrome API 失敗時は操作をロールバックし、トーストで通知する(データ損失ゼロの原則)。
- エラーを握り潰さない。想定外は上位に伝播しログ(`console.error`)に残す。外部送信はしない。

```typescript
class AliasLimitError extends Error {
  constructor(message: string, public readonly limit: number) {
    super(message);
    this.name = 'AliasLimitError';
  }
}

try {
  await aliasStore.upsert(url, aliases);
} catch (e) {
  if (e instanceof AliasLimitError) {
    showInlineError(`別名は1件あたり${e.limit}個までです`);
  } else {
    console.error('別名の保存に失敗:', e);
    throw e; // 上位へ伝播
  }
}
```

### Findmark 固有のルール
- **UIから `chrome.bookmarks` / `chrome.storage` を直接呼ばない**。必ず `packages/storage` 経由(レイヤー依存を守る)。
- **外部通信を書かない**。`fetch` / `XMLHttpRequest` / WebSocket は使用禁止(プライバシー方針)。レビューで必ず確認する。
- **破壊的操作(削除・移動)は必ずアンドゥ手段を伴わせる**。
- 別名・検索対象の比較は必ず `Normalizer` を通す(生文字列で比較しない)。

---

## Git運用ルール

### ブランチ戦略
実際のCI運用は `feature/* → dev → main` の2段階フロー。**PRは原則 `dev` ブランチ宛てに作成する**。

- `main`: リリース可能な状態(Web Store 提出可能)。`dev` からのマージのみ
- `dev`: 開発中の統合ブランチ。フィーチャーブランチのマージ先
- `feature/[機能名]`: 新機能(例: `feature/alias-editor`)
- `fix/[修正内容]`: バグ修正
- `refactor/[対象]`: リファクタリング
- `chore/[内容]`: 設定・ドキュメント等(例: `chore/findmark-template-setup`)

`main`/`dev` へは直接コミットせず、必ず `dev` から分岐したブランチを切って PR 経由でマージする。

> PRテンプレート(`.github/pull_request_template.md`)は `dev` 宛てを前提としており、`main` 宛てのPRは `auto-change-prs-branch.yml` により自動的に base が `dev` へ変更される。

### コミットメッセージ規約(Conventional Commits)
```
<type>(<scope>): <subject>

<body>

<footer>
```
**type**: `feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`
**scope 例**: `search` / `alias` / `popup` / `options` / `storage` / `trash` / `import-export`

```
feat(alias): 別名のチャンク分割保存を実装

chrome.storage.sync の 512アイテム制限を回避するため、AliasRecord を
100件ずつチャンク化して1キーに保存する。逆引きインデックスで対象チャンクのみ更新。

Closes #12
```

### プルリクエストプロセス
**作成前チェック**(pre-commit の husky + lint-staged が自動で prettier/eslint を実行):
- [ ] `pnpm type-check` が通る
- [ ] `pnpm lint` がエラーなし
- [ ] 関連ユニットテストがパス
- [ ] 外部通信コード(`fetch` 等)を追加していない

PRテンプレート(`.github/pull_request_template.md`)に従う。レビュー→承認後マージ。

---

## テスト戦略

> **⚠️ テスト基盤は現状未導入**: 本セクションは今後整備する方針を示すロードマップである。現状 `vitest` の `test` スクリプトは `chrome-extension` のみに存在し、`packages/shared` / `packages/storage` には未設定、`turbo.json` にも `test` タスクがなく、CIにもテスト実行ステップがない。実装着手時に「`packages/shared`・`packages/storage` へ vitest 追加 → `turbo.json` に `test` タスク追加 → CIへ組込み」を整備タスクとする。**以下のカバレッジ目標・コマンドは基盤導入後の目標値**であり、現時点で `pnpm test` は存在しない。

テストピラミッド: ユニット多め・統合中程度・E2E少数。ドメインロジック(`packages/shared`, `packages/storage`)を厚く、UIはE2Eで主要導線を担保する。

### ユニットテスト
**対象**: `Normalizer` / `SearchEngine` / `AliasStore` / `ImportExportService` など純粋ロジック。
**カバレッジ目標**: shared / storage で 80% 以上(基盤導入後の目標)。
**配置**: 対象と同階層(co-located)、`[対象].test.ts`。

```typescript
describe('Normalizer', () => {
  it('normalizeText_カタカナとひらがな_同一視される', () => {
    const n = new Normalizer();
    expect(n.normalizeText('カクチョウ')).toBe(n.normalizeText('かくちょう'));
  });

  it('normalizeText_全角半角_NFKCで統一される', () => {
    const n = new Normalizer();
    expect(n.normalizeText('ＤＯＣＳ')).toBe('docs');
  });
});

describe('AliasStore', () => {
  it('upsert_21個目の別名_AliasLimitErrorをスローする', async () => {
    const store = new AliasStore(mockStorage);
    const twenty = Array.from({ length: 20 }, (_, i) => `a${i}`);
    await store.upsert('https://x.test', twenty);
    await expect(store.upsert('https://x.test', [...twenty, 'over']))
      .rejects.toThrow(AliasLimitError);
  });
});
```

### 統合テスト
**対象**: 複数コンポーネントの連携(別名付与→検索ヒット→ハイライト、移動→アンドゥ→復元)。`chrome.*` はモックする。

### E2Eテスト
**ツール**: ボイラープレート同梱のE2E基盤(拡張機能をロード)。`pnpm e2e`。
**主要シナリオ**:
- 起動 → 検索 → Enter で開く
- ドラッグ&ドロップでフォルダ移動(スプリングロード/オートスクロール)
- Options で独自JSONエクスポート → 別プロファイルでインポート → 別名維持
- ゴミ箱からフォルダごと復元

### テスト命名規則
パターン: `[対象]_[条件]_[期待結果]`(日本語可)。`test1` / `works` のような曖昧名は禁止。

### モック方針
- 外部依存(Chrome API・ストレージ)はモック化する。
- ビジネスロジックは実装をそのまま使う。

---

## コードレビュー基準

### レビューポイント
**機能性**: 要件充足 / エッジケース / エラーハンドリング / アンドゥの有無
**可読性**: 命名の明確さ / 複雑ロジックの説明
**保守性**: 重複排除 / レイヤー責務の分離(UIがChrome APIを直接呼んでいないか)
**パフォーマンス**: 正規化のメモ化 / 仮想スクロール / 不要な再描画
**セキュリティ/プライバシー**: **外部通信の有無(必須確認)** / URL検証 / 権限追加の妥当性

### レビューコメントの優先度
`[必須]` 修正必須 / `[推奨]` 修正推奨 / `[提案]` 検討 / `[質問]` 確認。建設的に、理由と代替案を添えて書く。

---

## 開発環境セットアップ

### 必要なツール

| ツール | バージョン | 備考 |
|--------|-----------|------|
| Node.js | 22.15.1 (`.nvmrc`) | `nvm use` で切替 |
| pnpm | 10.11.0 | `corepack enable` で有効化 |
| Chrome | MV3対応版 | 拡張ロード用 |

### セットアップ手順
```bash
# 1. リポジトリのクローン
git clone <URL>
cd Findmark

# 2. Node バージョンを合わせる
nvm use            # .nvmrc の 22.15.1

# 3. 依存関係のインストール(postinstall で .env をコピー)
pnpm install

# 4. 開発ビルド(HMR。dist/ を生成)
pnpm dev           # Firefox 向けは pnpm dev:firefox

# 5. Chrome に読み込む
#    chrome://extensions → デベロッパーモードON → 「パッケージ化されていない拡張機能を読み込む」→ dist/
```

### 主要スクリプト

| コマンド | 用途 |
|---------|------|
| `pnpm dev` | 開発ビルド + watch(HMR) |
| `pnpm build` | 本番ビルド(`dist/`) |
| `pnpm zip` | ストア提出用zip生成 |
| `pnpm type-check` | 型チェック(turbo) |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm format` | Prettier |
| `pnpm e2e` | E2Eテスト |

### 品質自動化(既存構成)
- **Husky pre-commit + lint-staged**: 変更ファイルに `prettier --write` と `eslint --fix` を自動適用。
- **GitHub Actions**: `lint.yml` / `prettier.yml` / `e2e.yml` / `build-zip.yml` / `codeql.yml` などが PR で実行される。CI をパスしないPRはマージしない。
