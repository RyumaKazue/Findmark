# 設計書

## アーキテクチャ概要

pnpm workspace + Turborepo のモノレポに、ドメインロジック層（`packages/shared`・`packages/storage`）のユニットテスト実行基盤を追加する。テストランナーは、`chrome-extension` が既に宣言している `vitest`（ただし未インストール・未設定）に揃えて **vitest** を採用する。テスト実行は turbo の `test` タスクとして集約し、ルート `pnpm test` → 各パッケージの `vitest run` へ委譲する。

```
pnpm test (root)
   └─ turbo test
        ├─ @extension/shared   : vitest run  (vitest.config.ts, *.test.ts co-located)
        ├─ @extension/storage  : vitest run  (vitest.config.ts, *.test.ts co-located)
        └─ chrome-extension    : vitest run  (passWithNoTests: 実テストは U17)
CI (.github/workflows/test.yml)
   └─ pnpm install --frozen-lockfile → pnpm test
```

## コンポーネント設計

### 1. vitest 設定（packages/shared, packages/storage, chrome-extension）

**責務**:
- co-located の `*.test.ts` を検出して実行する。
- coverage（v8）を出力し、shared/storage は 80% を目標値として設定する（本単位では閾値 fail は課さない）。
- Node 環境（`environment: 'node'`）でドメインロジックを実行する（DOM 非依存）。

**実装の要点**:
- `vitest.config.ts` を各パッケージ直下に置く。`test.include: ['lib/**/*.test.ts']`、`test.environment: 'node'`。
- coverage は `@vitest/coverage-v8`。`coverage.provider: 'v8'`、`coverage.thresholds` は shared/storage で 80 を **記載するがコメントで「実測が揃う U3 以降で gate 化」と注記**（本単位はスモークのみのため閾値 enforce しない → `thresholds` は設定せず目標をコメント化）。
- `chrome-extension` は `test.passWithNoTests: true`（実テストが無くても `turbo test` を緑にする）。
- ルート型定義汚染を避けるため、各 config は個別パッケージスコープに閉じる。

### 2. package.json スクリプト・依存

**責務**:
- 各パッケージに `"test": "vitest run"` を用意し、turbo から一様に呼べるようにする。
- ルートに `"test": "turbo test"` を追加。

**実装の要点**:
- devDependencies に `vitest` と `@vitest/coverage-v8` を追加する（shared / storage / chrome-extension）。バージョンは Node 22.15 で動作する安定版（`vitest ^3` 系）を採用し、`pnpm-lock.yaml` を更新する。
- `chrome-extension` は既に `"test": "vitest run"` を宣言済み。スクリプトはそのまま活かし、依存と config を補う。

### 3. turbo test タスク

**責務**:
- 各パッケージの `test` スクリプトを turbo で集約実行する。

**実装の要点**:
- `turbo.json` の `tasks` に `"test": { "dependsOn": ["^ready"], "outputs": ["coverage/**"], "cache": false }` を追加する。
  - `^ready`: 依存パッケージの `tsc -b`（`ready`）成果物に依存。storage/shared は相互参照があるため、ビルド前段を担保する。
  - `cache: false`: 既存タスク群の方針に揃える（安定するまでキャッシュしない）。

### 4. packages/ui の `@/lib/*` インポート是正（U1 申し送り）

**責務**:
- ui ソースが公開 API（`index.ts`）経由でコンシューマに型解決される際、内部エイリアス `@/*` が漏れて TS2307 になる問題を解消する。

**実装の要点**:
- `@/*` エイリアスは `packages/ui/tsconfig.json` の `paths` にのみ定義され、コンシューマ（`pages/*`）の tsconfig には無い。ui を dist ではなくソース（`types: "index.ts"`）で型解決するため、内部エイリアスは相対パスに書き換えるのが最小・確実な是正。
- 対象:
  - `packages/ui/lib/components/ToggleButton.tsx`: `@/lib/utils` → `../utils`
  - `packages/ui/lib/components/error-display/ErrorDisplay.tsx`: `@/lib/components/error-display/ErrorHeader` → `./ErrorHeader`、`ErrorResetButton` → `./ErrorResetButton`、`ErrorStackTraceList` → `./ErrorStackTraceList`
- 是正後、`packages/ui` 単体・コンシューマ双方の type-check が通ることを確認する。`tsconfig.json` の `@/*` paths 自体は他に用途があれば残置可（今回は import のみ是正、alias 定義は影響なければ触らない）。

## データフロー

### ユニットテスト実行（ローカル）
```
1. 開発者が `pnpm test` を実行
2. turbo が各パッケージの `test`（vitest run）を並列実行
3. vitest が co-located `*.test.ts` を検出・実行
4. 結果（pass/fail・coverage）を集約表示
```

### CI 実行
```
1. PR 作成/更新をトリガに test.yml が起動
2. pnpm install --frozen-lockfile --prefer-offline
3. pnpm test を実行し、失敗時に CI を fail させる
```

## エラーハンドリング戦略

### カスタムエラークラス
- 本単位では新規エラークラスは不要（基盤整備のみ）。

### エラーハンドリングパターン
- `vitest run` が非ゼロ終了で turbo/CI を fail させる（テスト失敗を検知）。
- `passWithNoTests` は `chrome-extension` にのみ適用し、shared/storage はスモークテスト必須で「テスト0件で誤って緑」を防ぐ。

## テスト戦略

### ユニットテスト
- スモークテスト（`packages/shared/lib/__smoke__.test.ts` 等、co-located 方針に沿った最小の1件）でハーネスの起動を検証する。
- 実ロジックのユニットテストは U3（Normalizer）以降で対象ファイルと同階層に追加。

### 統合テスト
- 本単位では対象外。

## 依存ライブラリ

新規追加（shared / storage / chrome-extension の devDependencies）:

```json
{
  "devDependencies": {
    "vitest": "^4.1.10",
    "@vitest/coverage-v8": "^4.1.10"
  }
}
```

> バージョンは `pnpm add -D` 実行時に Node 22.15 対応の最新安定版へ解決した結果、`^4.1.10`（v4 系）を採用した（当初案の `^3` から更新。全品質ゲート通過を確認済み）。ルート `package.json` に共通で置く選択肢もあるが、パッケージ境界を明確にするため各パッケージの devDependencies に置く。

## ディレクトリ構造

```
package.json                         # scripts に "test": "turbo test" 追加
turbo.json                           # tasks に "test" 追加
.github/workflows/test.yml           # 新規: ユニットテスト CI
packages/shared/
  package.json                       # "test" + vitest devDeps
  vitest.config.ts                   # 新規
  lib/__smoke__.test.ts              # 新規スモークテスト
packages/storage/
  package.json                       # "test" + vitest devDeps
  vitest.config.ts                   # 新規
  lib/__smoke__.test.ts              # 新規スモークテスト
chrome-extension/
  package.json                       # vitest devDeps 追加（test スクリプトは既存）
  vitest.config.ts                   # 新規（passWithNoTests）
packages/ui/lib/components/ToggleButton.tsx            # import 是正
packages/ui/lib/components/error-display/ErrorDisplay.tsx  # import 是正
```

## 実装の順序

1. `packages/ui` の `@/lib/*` インポートを相対パスへ是正し、`pnpm type-check` 全体通過を確認（先に基盤の型を健全化）。
2. `packages/shared` に vitest（devDeps・config・スモークテスト・test スクリプト）を追加。
3. `packages/storage` に同様に追加。
4. `chrome-extension` に vitest devDeps・config（passWithNoTests）を追加。
5. `turbo.json` に `test` タスク、ルート `package.json` に `test` スクリプトを追加。
6. `.github/workflows/test.yml` を追加。
7. 品質チェック（`pnpm test` / `pnpm lint` / `pnpm type-check` / `pnpm build`）。

## セキュリティ考慮事項

- CI トリガは、fork からの改変コードを実行する `pull_request_target` の危険性を避け、`pull_request` を採用する（外部通信ゼロ方針・最小権限のプロダクト思想に整合）。
- テスト実行はネットワークアクセスを伴わない純粋ロジックに限定する。

## パフォーマンス考慮事項

- `test` タスクは `cache: false`。テストが増えてきたら turbo キャッシュ有効化・入力（inputs）指定で高速化を検討（本単位では対象外）。
- vitest はデフォルト並列。CI ランナーでも十分高速。

## 将来の拡張性

- U3 以降は co-located `*.test.ts` を追加するだけで `pnpm test` に取り込まれる。
- 実測カバレッジが揃った段階で `coverage.thresholds` を設定し、CI で 80% gate 化できる。
- 統合テストが必要になれば `tests/integration/` を workspace パッケージ化して同じ turbo `test` に載せられる。
