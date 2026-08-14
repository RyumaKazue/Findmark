import { moveSelectionIndex } from './listNavigationModel.js';
import { describe, expect, it } from 'vitest';

describe('moveSelectionIndex', () => {
  it('中間の行は従来どおり 1 つずつ移動する', () => {
    expect(moveSelectionIndex(3, -1, 10)).toBe(2);
    expect(moveSelectionIndex(3, 1, 10)).toBe(4);
  });

  it('先頭で ↑ を押すと末尾へ循環する（AC-1）', () => {
    expect(moveSelectionIndex(0, -1, 10)).toBe(9);
  });

  it('末尾で ↓ を押すと先頭へ循環する（AC-2）', () => {
    expect(moveSelectionIndex(9, 1, 10)).toBe(0);
  });

  it('結果が 1 件のときは循環先が自分自身になる（AC-4）', () => {
    expect(moveSelectionIndex(0, -1, 1)).toBe(0);
    expect(moveSelectionIndex(0, 1, 1)).toBe(0);
  });

  it('結果が 0 件のときは常に 0 を返す（AC-4）', () => {
    expect(moveSelectionIndex(0, -1, 0)).toBe(0);
    expect(moveSelectionIndex(0, 1, 0)).toBe(0);
  });

  it('count が負でも 0 を返す（防御的デフォルト）', () => {
    expect(moveSelectionIndex(3, 1, -1)).toBe(0);
  });

  it('current が範囲外でも戻り値は 0 <= n < count に収まる（AC-4）', () => {
    // 上振れ: 結果件数が減った直後に keydown が届いた場合など。
    expect(moveSelectionIndex(42, 1, 10)).toBe(3);
    expect(moveSelectionIndex(10, -1, 10)).toBe(9);
    // 下振れ: 想定外の負値が入っても破綻しない。
    expect(moveSelectionIndex(-1, 1, 10)).toBe(0);
    expect(moveSelectionIndex(-5, -1, 10)).toBe(4);
  });

  it('delta が 0 のときは現在値を範囲内へ正規化して返す', () => {
    expect(moveSelectionIndex(3, 0, 10)).toBe(3);
    expect(moveSelectionIndex(12, 0, 10)).toBe(2);
  });

  it('±1 の往復で元のインデックスへ戻る（端でも成立する）', () => {
    expect(moveSelectionIndex(moveSelectionIndex(0, -1, 10), 1, 10)).toBe(0);
    expect(moveSelectionIndex(moveSelectionIndex(9, 1, 10), -1, 10)).toBe(9);
  });
});
