# タスクリスト

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

## フェーズ0: packages/ui 型解決エラー是正（U1 申し送り）

- [x] `packages/ui/lib/components/ToggleButton.tsx` の `@/lib/utils` を相対パス（`../utils`）へ是正
- [x] `packages/ui/lib/components/error-display/ErrorDisplay.tsx` の 3 つの `@/lib/components/error-display/*` インポートを相対パス（`./ErrorHeader` 等）へ是正
- [x] 全体 `pnpm type-check` が通ることを確認（`pages/options` / `pages/devtools-panel` / `pages/content-runtime` の TS2307 解消）

## フェーズ1: packages/shared への vitest 導入

- [x] `vitest` / `@vitest/coverage-v8` を devDependency に追加（`pnpm add -D`）
- [x] `packages/shared/package.json` に `"test": "vitest run"` スクリプトを追加
- [x] `packages/shared/vitest.config.ts` を作成（`include: lib/**/*.test.ts`、`environment: 'node'`、coverage v8）
- [x] スモークテスト `packages/shared/lib/__smoke__.test.ts` を追加
- [x] `pnpm -F @extension/shared test` がパスすることを確認

## フェーズ2: packages/storage への vitest 導入

- [x] `vitest` / `@vitest/coverage-v8` を devDependency に追加
- [x] `packages/storage/package.json` に `"test": "vitest run"` スクリプトを追加
- [x] `packages/storage/vitest.config.ts` を作成
- [x] スモークテスト `packages/storage/lib/__smoke__.test.ts` を追加
- [x] `pnpm -F @extension/storage test` がパスすることを確認

## フェーズ3: chrome-extension のテスト整備

- [x] `vitest` / `@vitest/coverage-v8` を devDependency に追加（`test` スクリプトは既存）
- [x] `chrome-extension/vitest.config.ts` を作成（`passWithNoTests: true`）
- [x] `pnpm -F chrome-extension test` が緑（テスト0件でも成功）になることを確認

## フェーズ4: turbo / ルートスクリプト

- [x] `turbo.json` の `tasks` に `test`（`dependsOn: ["^ready"]`、`cache: false`、`outputs: coverage/**`）を追加
- [x] ルート `package.json` に `"test": "turbo test"` を追加
- [x] ルートで `pnpm test` を実行し、全パッケージのテストが走ることを確認

## フェーズ5: CI へのテスト実行ステップ追加

- [x] `.github/workflows/test.yml` を作成（`pull_request` トリガ、`.nvmrc` の Node、pnpm セットアップ、`pnpm install --frozen-lockfile` → `pnpm test`）
- [x] 既存 lint.yml / prettier.yml とセットアップ規約が整合していることを確認

## フェーズ6: 品質チェックと修正

- [x] `pnpm test`（ルート）が通ることを確認（turbo 11 タスク成功）
- [x] `pnpm lint` がエラーなく通ることを確認（15 タスク成功。test/config ファイルは typed-lint 対象外へ）
- [x] `pnpm type-check` がエラーなく通ることを確認（14 タスク成功。U1 の TS2307 解消）
- [x] `pnpm build` が成功することを確認（16 タスク成功。test ファイルは dist へ非流出）
- [x] `pnpm-lock.yaml` が更新され、`--frozen-lockfile` で整合することを確認

## フェーズ7: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.mdの各要件）と実装を突き合わせOK/NGを一覧化（全項目OK。下記報告）
- [x] ユーザーに検証を依頼
- [x] 受け入れ承認（ゲート2）を取得（2026-07-24 承認取得）
  - NGがあった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ8: ドキュメント更新・振り返り（モード4）

- [x] `docs/mvp-development-flow.md` の進捗表で U2 を「完了」に更新
- [x] `docs/repository-structure.md` / `docs/development-guidelines.md` の「テスト基盤は現状未整備」注記を実態（整備済み）に合わせて更新
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

- 検証→戻り（モード3のA/B/C手戻り）: なし（受け入れ基準は全項目 OK で一発通過）
- 補足: 実装中の自己検証（品質チェック）で lint が一度失敗した（新規 `*.test.ts` / `vitest.config.ts` が typed-lint の projectService に解決されない TS parse エラー）。これは受け入れ検証前の自己修正であり、eslint override 追加で解消。さらに `implementation-validator` の指摘により override の glob を `**/*.config.*`（広すぎ）→ `**/vitest.config.*` へ絞り込んで確定（lint 15/15 維持を再確認）。いずれも受け入れ基準の手戻りではない。

---

## 実装後の振り返り

### 実装完了日
2026-07-24

### 計画と実績の差分

**計画と異なった点**:
- **vitest のバージョン**: 計画（design.md）では `^3.2.0` 系を想定していたが、`pnpm add -D` が最新安定版へ解決した結果 `^4.1.10`（v4 系）を採用。全品質ゲート通過を確認し、design.md の版数記載も v4 系へ更新した。
- **test ファイルの dist 非流出対応**（計画外の追加対応）: shared/storage の `module.json` は `noEmit: false` で `tsc -b`（ready/build）が実際に emit するため、`lib/**/*.test.ts` を build tsconfig から `exclude` する対応を追加。未対応だと public な `dist/`（`"files": ["dist/**"]`）にテストが混入していた。
- **eslint typed-lint 対応**（計画外の追加対応）: 新規 `*.test.ts` / `vitest.config.ts` が typed-lint（`projectService`）に解決されず lint が失敗したため、当該ファイルのみ型依存ルールを無効化する override を `eslint.config.ts` に追加。

**新たに必要になったタスク**:
- `tsconfig.json` への `exclude` 追加（shared / storage）: 上記 dist 非流出のため。
- `eslint.config.ts` の override 追加: 上記 typed-lint 解決のため。
- `eslint.config.ts` を `typescript-eslint` の非推奨 `config()` から `eslint/config` の `defineConfig()` へ移行: コミット時の husky（lint-staged）が root `eslint.config.ts` を単体 lint した際、既存の `import-x/no-deprecated`（`config` 非推奨）エラーで pre-commit が失敗したため。`pnpm lint`（turbo）は各パッケージ配下のみを lint し root 設定ファイル自体は対象外だったため、この既存負債はコミット時に初めて表面化した。root-cause 修正として移行し、全 lint 15/15 通過を再確認。
- いずれも計画時に想定していなかったが、テスト基盤導入・コミットフローの副作用として必然的に必要になった。

**技術的理由でスキップしたタスク**（該当する場合のみ）:
- なし（全タスク完了）。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 0（受け入れ基準は全項目 OK で一発通過。A/B/C の手戻りなし）
- 主な不一致と分類: なし（自己検証中の lint 失敗と validator 指摘による glob 絞り込みは、受け入れ検証前の自己修正であり手戻りに該当しない）
- 受け入れ承認: 2026-07-24 取得

### 学んだこと

**技術的な学び**:
- モノレポで co-located テストを導入する際は、`tsc -b`（emit 有効）の build 対象からテストを除外しないと public dist にテストが混入する。「型チェック/lint はテストを見る」「build はテストを emit しない」を両立させるには build tsconfig 側の `exclude` が要点。
- typescript-eslint の `projectService: true` は tsconfig の project に属さないファイル（build から除外したテスト・ルートの設定ファイル）で parse エラーになる。対象を絞って型依存ルールを無効化する override が定石。glob は広げすぎると既存 config 群の typed-lint を意図せず殺すため、`vitest.config.*` のように最小スコープにする。
- turbo の `test` タスクは `dependsOn: ["^ready"]`（上流パッケージのビルド成果物）に依存させれば十分。vitest はソースを直接実行するが、workspace 依存は `dist/index.mjs` 経由で解決されるため。

**プロセス上の改善点**:
- `pnpm add` は実行前に読み込んだ `package.json` を書き戻すため、インストール中に別途行った手動の `package.json` 編集が上書き（クロバー）されることがある。実際に storage の `test` スクリプト追記が消えたため再追記した。**依存追加（`pnpm add`）と同一 `package.json` への手動編集を並行させない**（add 完了後に編集する）ことを徹底する。
- `implementation-validator` が override の過剰スコープを検出し、実際に絞っても 15/15 通ることまで確認してくれた。自己検証（品質ゲート緑）だけでは「通るが過剰」を見逃すため、レビューエージェントの併用が有効だった。

### 次回への改善提案
- U3（normalizer-core）以降は、co-located の `*.test.ts` を追加すれば `pnpm test` に自動で取り込まれる。実ロジックのテストが揃い始めたら、各 `vitest.config.ts` の `coverage.thresholds`（80%）を有効化し CI で gate 化する（現状は目標値をコメントで保持）。
- U17（service-worker）で chrome-extension に実テストを追加する際、`passWithNoTests` を外す（または実テスト前提で維持を再判断する）。
- 依存追加を伴う作業単位では、`pnpm add` を先に完了させてから `package.json` を手動編集する順序を守る。
