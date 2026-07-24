import { defineConfig } from 'vitest/config';

// ドメインロジック層のユニットテスト設定。
// テストは対象コードと同階層(co-located)の `lib/**/*.test.ts` に配置する
// (docs/repository-structure.md「テストファイル」)。
export default defineConfig({
  test: {
    // ブラウザ/React 非依存の純粋ロジックを対象とするため Node 環境で実行する。
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.test.ts'],
      reporter: ['text', 'html'],
      // 目標: shared は 80% 以上(docs/development-guidelines.md「テスト戦略」)。
      // 実ロジックが揃う U3 以降で thresholds を設定し CI で gate 化する。
    },
  },
});
