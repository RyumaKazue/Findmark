import { defineConfig } from 'vitest/config';

// chrome-extension(Service Worker 等)のユニットテスト設定。
// U17(service-worker)で起動時クリーンアップ/ショートカット確認のテストを追加済み。
// passWithNoTests は、テストを持たないエントリのみに変更した際も `turbo test` を止めないために残す。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
