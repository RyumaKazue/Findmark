import { buildRowMenuItems, canOpenRowMenu } from './rowMenuModel.js';
import { describe, expect, it } from 'vitest';
import type { RowMenuContext } from './rowMenuModel.js';

/** 判定文脈のビルダー。既定は「通常モード + 対象行あり」（メニューが開く一般的な状態）。 */
const ctx = (over: Partial<RowMenuContext> = {}): RowMenuContext => ({
  selectionMode: false,
  hasTarget: true,
  ...over,
});

describe('canOpenRowMenu（メニューを開いてよいか）', () => {
  it('通常モード + 対象行あり → 開く', () => {
    expect(canOpenRowMenu(ctx())).toBe(true);
  });

  it('選択モード中は開かない（一括操作バーが行操作を担うため・AC-8）', () => {
    expect(canOpenRowMenu(ctx({ selectionMode: true }))).toBe(false);
  });

  it('対象行が無ければ開かない（結果0件・範囲外への防御）', () => {
    expect(canOpenRowMenu(ctx({ hasTarget: false }))).toBe(false);
  });

  it('選択モード中かつ対象行なしでも開かない', () => {
    expect(canOpenRowMenu(ctx({ selectionMode: true, hasTarget: false }))).toBe(false);
  });
});

describe('buildRowMenuItems（項目の並び）', () => {
  it('編集 → 別名を編集 → 移動 → 削除 の順で返す（AC-1）', () => {
    expect(buildRowMenuItems().map(item => item.key)).toEqual(['edit', 'alias-edit', 'move', 'delete']);
  });

  it('削除だけが破壊的（danger）で、その上に区切り線が入る', () => {
    const items = buildRowMenuItems();
    const deleteItem = items.find(item => item.key === 'delete');
    expect(deleteItem?.danger).toBe(true);
    expect(deleteItem?.separatorBefore).toBe(true);
  });

  it('削除以外は danger でも区切りでもない', () => {
    for (const item of buildRowMenuItems().filter(i => i.key !== 'delete')) {
      expect(item.danger).toBeUndefined();
      expect(item.separatorBefore).toBeUndefined();
    }
  });

  it('区切り線は1本だけ（メニューが分割されすぎない）', () => {
    expect(buildRowMenuItems().filter(item => item.separatorBefore).length).toBe(1);
  });
});
