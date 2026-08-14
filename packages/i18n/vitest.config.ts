import { defineConfig } from 'vitest/config';

// 文言レイヤー(ロケール解決・カタログ展開)のユニットテスト設定。
// テストは対象コードと同階層(co-located)の `lib/**/*.test.ts` に配置する
// (docs/repository-structure.md「テストファイル」)。
export default defineConfig({
  test: {
    // React 非依存の純粋ロジック(runtime.ts)とカタログ整合のみを対象とするため Node 環境で実行する。
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/runtime.ts'],
      exclude: ['lib/**/*.test.ts'],
      reporter: ['text', 'html'],
      // 文言解決はフォールバックを含めユーザー影響が大きいため 80% を CI gate 化する
      // (docs/development-guidelines.md「テスト戦略」)。
      thresholds: {
        'lib/runtime.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
