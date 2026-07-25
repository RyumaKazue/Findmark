import { defineConfig } from 'vitest/config';

// popup の純粋ロジック（頭文字アバター・仮想スクロール計算・フォルダツリー構築）のユニットテスト設定。
// React/DOM に依存しない関数のみを対象とするため Node 環境で実行する（UI 主要導線は E2E が担保）。
// テストは対象と同階層（co-located）の src/**/*.test.ts に配置する。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
