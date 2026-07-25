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
      // U5 で実ロジック(aliasStore.ts)が揃ったため、当該ファイルに限定して 80% を CI gate 化する。
      // base.ts(基盤の createStorage)・example-theme-storage.ts(ボイラープレート由来の未使用デモ)は
      // 本作業単位の対象外のため、パッケージ全体のしきい値化は該当ファイルの整備後に行う。
      thresholds: {
        'lib/impl/aliasStore.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
