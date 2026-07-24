# 要求内容

## 概要

ドメインロジックのユニットテストを実行できる基盤を整備する。`packages/shared` / `packages/storage` に vitest を導入し、`turbo.json` に `test` タスクを追加、CI にテスト実行ステップを追加する。あわせて、U1 から申し送られた `packages/ui` の型解決エラー（`@/lib/*` がコンシューマ側で解決できない既存負債）を是正する。これは MVP のあらゆる後続作業単位（U3 以降）の品質ゲートの前提となる基盤タスク（作業単位 U2）である。

## 背景

- 本作業は [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) の作業単位 **U2 (test-infrastructure)** に対応する。
- [docs/repository-structure.md](../../docs/repository-structure.md) 「テストファイル」および [docs/development-guidelines.md](../../docs/development-guidelines.md) 「テスト戦略」が、実装着手時の必須対応として以下の現状ギャップを明記している:
  - `test` スクリプトは `chrome-extension` にのみ存在する（かつ vitest 未インストールで実際には実行不可）。`packages/shared` / `packages/storage` には `test` スクリプトも vitest 設定も無い。
  - `turbo.json` に `test` タスクが無い（build/dev/lint/type-check/e2e のみ）。ルートにも `pnpm test` が無い。
  - CI（`.github/workflows/`）にユニットテスト実行ステップが無い（lint / prettier / e2e のみ）。
- U3（Normalizer）以降の作業単位は「ユニットテスト付きで完成」を受け入れ基準としており、テストを書いて実行できる土台が先に必要。
- U1 の申し送り: 全体 `pnpm type-check` が `packages/ui` 由来の `@/lib/utils` 等の解決エラー（TS2307）で失敗する。`packages/ui` 単体の type-check は通るが、`pages/options` / `pages/devtools-panel` / `pages/content-runtime` がソース（`.tsx`）を型解決する際、ui 内部の `@/*` パスエイリアスがコンシューマ側の tsconfig で解決できず失敗する。これを是正しないと全体の型チェックが品質ゲートとして機能しない。

## 実装対象の機能

### 1. packages/shared・packages/storage への vitest 導入
- 両パッケージに vitest を devDependency として追加する。
- 両パッケージの `package.json` に `"test": "vitest run"` スクリプトを追加する。
- 両パッケージに vitest 設定ファイル（`vitest.config.ts`）を追加し、`packages/shared`・`packages/storage` で 80% カバレッジを目標とする方針（development-guidelines）に沿った coverage 設定を行う。
- ユニットテストは対象ファイルと同階層（co-located、`[対象].test.ts`）に置く方針（repository-structure）を設定で許可する。
- テストハーネスが動作することを確認するためのスモークテストを各パッケージに1件配置する（実ロジックのテストは U3 以降で追加）。

### 2. turbo.json への test タスク追加
- `turbo.json` の `tasks` に `test` を追加する（キャッシュ方針・依存関係を含む）。
- ルート `package.json` に `"test": "turbo test"` スクリプトを追加する。

### 3. CI へのテスト実行ステップ追加
- `.github/workflows/` にユニットテストを実行するワークフローを追加する（`pnpm install` → `pnpm test`）。
- 既存ワークフロー（lint.yml / prettier.yml）の構成・トリガに整合させる。

### 4. packages/ui の型解決エラー是正（U1 申し送り）
- `packages/ui` のソース内の `@/lib/*` インポート（`ToggleButton.tsx` の `@/lib/utils`、`error-display/ErrorDisplay.tsx` の 3 インポート）を、コンシューマ側でも解決できる形（相対パス）へ是正する。
- 是正後、全体 `pnpm type-check` が全パッケージで通ることを確認する。

## 受け入れ条件

### vitest 導入（shared / storage）
- [ ] `packages/shared` で `pnpm test` が実行でき、スモークテストがパスする
- [ ] `packages/storage` で `pnpm test` が実行でき、スモークテストがパスする
- [ ] 両パッケージに vitest 設定があり、co-located `*.test.ts` を拾える／coverage を出力できる

### turbo / ルートスクリプト
- [ ] ルートで `pnpm test` を実行すると turbo 経由で両パッケージのテストが走る
- [ ] `turbo.json` に `test` タスクが定義されている

### CI
- [ ] `.github/workflows/` にユニットテストを実行するステップ／ワークフローが追加されている
- [ ] 追加したワークフローが既存の lint/prettier ワークフローと同じ Node/pnpm セットアップ規約に沿っている

### 型解決是正（U1 申し送り）
- [ ] `packages/ui` の `@/lib/*` インポートが是正されている
- [ ] 全体 `pnpm type-check` がエラーなく通る（`pages/options` / `pages/devtools-panel` / `pages/content-runtime` の TS2307 が解消）

### 品質ゲート
- [ ] `pnpm lint` がエラーなく通る
- [ ] `pnpm build` が成功する（テスト基盤追加でビルドが壊れない）

## 成功指標
- `pnpm test`（ルート）が緑で、shared / storage のユニットテストを CI で自動実行できる。
- 全体 `pnpm type-check` が通り、以降の作業単位で型チェックが品質ゲートとして機能する。
- U3 以降が「co-located の `*.test.ts` を書けば `pnpm test` で回る」状態になる。

## スコープ外

以下はこのフェーズでは実装しません:

- 各ドメインロジック（Normalizer / AliasStore / SearchEngine 等）の実テスト（U3 以降で対象ファイルとともに追加）
- 統合テスト（`tests/integration/`）の新設（必要になった作業単位で判断）
- E2E テスト基盤の改変（既存の `tests/e2e` は現状維持）
- 80% カバレッジ閾値の CI 強制（本単位では設定と目標値の用意まで。実測が集まる U3 以降で閾値 gate 化を検討）
- `pages/*`（React UI パッケージ）へのテスト導入（UI 作業単位で必要に応じて判断）

## 未確定の論点（承認前に判断が必要）

- **vitest カバレッジ閾値を CI で強制するか**: 本単位ではロジックがまだ無く実測できないため、**閾値 gate は設けず「80% 目標」を設定値として用意するに留める**ことを推奨する（実閾値の強制は U3 以降）。
- **`chrome-extension` の既存 `"test": "vitest run"` の扱い**: vitest 未インストールで実行不可。`turbo test` が失敗しないよう、**`chrome-extension` にも vitest を導入し `--passWithNoTests` 相当の設定で通す**方針を推奨する（テスト自体は U17 の Service Worker 単位で追加）。
- **CI トリガ**: 既存が `pull_request_target` のため踏襲するが、テスト実行はコード実行を伴うため **`pull_request`（fork からの改変コードを信頼しない）** を推奨する。レビュー時に確認したい。

## 参照ドキュメント

- [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) - MVP開発フロー（作業単位 U2）
- [docs/development-guidelines.md](../../docs/development-guidelines.md) - 「テスト戦略」（vitest 導入・カバレッジ 80% 目標）
- [docs/repository-structure.md](../../docs/repository-structure.md) - 「テストファイル」（co-located `*.test.ts`・整備タスク）
- [docs/architecture.md](../../docs/architecture.md) - レイヤー依存（UI→サービス→データ）・純粋ドメインロジックの単体テスト方針
