import { defineConfig } from 'vitest/config';

// chrome-extension(Service Worker 等)のユニットテスト設定。
// 現状は実テスト未追加のため、テストが 0 件でも `turbo test` を緑にする
// (passWithNoTests)。実テストは U17(service-worker)で追加する。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
