import { defineConfig } from 'vitest/config';

// データレイヤー(chrome.storage/bookmarks ラッパ)のユニットテスト設定。
// テストは対象コードと同階層(co-located)の `lib/**/*.test.ts` に配置する
// (docs/repository-structure.md「テストファイル」)。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.test.ts'],
      reporter: ['text', 'html'],
      // 目標: storage は 80% 以上(docs/development-guidelines.md「テスト戦略」)。
      // 実ロジックが揃う U5 以降で thresholds を設定し CI で gate 化する。
    },
  },
});
