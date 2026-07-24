import { describe, expect, it } from 'vitest';

// テストハーネス(vitest)が起動することを確認するためのスモークテスト。
// 実ロジックのユニットテストは U4(bookmark-service)/U5(alias-store)以降で
// 対象コードと同階層に追加する。
describe('vitest harness (storage)', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
