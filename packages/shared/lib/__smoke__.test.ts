import { describe, expect, it } from 'vitest';

// テストハーネス(vitest)が起動することを確認するためのスモークテスト。
// 実ロジックのユニットテストは U3(normalizer-core)以降で対象コードと同階層に追加する。
describe('vitest harness (shared)', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
