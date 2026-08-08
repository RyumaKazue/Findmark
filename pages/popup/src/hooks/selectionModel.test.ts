import { clear, emptySelection, isSelected, rangeTo, selectAll, toggle } from './selectionModel.js';
import { describe, expect, it } from 'vitest';

const orderedIds = ['a', 'b', 'c', 'd', 'e'];

describe('toggle（個別トグル）', () => {
  it('未選択の id を追加し、anchor を id に更新する', () => {
    const next = toggle(emptySelection, 'b');
    expect(isSelected(next, 'b')).toBe(true);
    expect(next.anchorId).toBe('b');
  });

  it('選択済みの id を解除する', () => {
    const selected = toggle(emptySelection, 'b');
    const next = toggle(selected, 'b');
    expect(isSelected(next, 'b')).toBe(false);
  });

  it('複数回のトグルで他の選択は保持される', () => {
    let state = toggle(emptySelection, 'a');
    state = toggle(state, 'c');
    expect(isSelected(state, 'a')).toBe(true);
    expect(isSelected(state, 'c')).toBe(true);
    expect(state.anchorId).toBe('c');
  });
});

describe('rangeTo（範囲選択）', () => {
  it('anchor が無い場合は target の単一選択になる', () => {
    const next = rangeTo(emptySelection, 'c', orderedIds);
    expect([...next.ids]).toEqual(['c']);
    expect(next.anchorId).toBe('c');
  });

  it('anchor から target までの範囲を選択する（正順）', () => {
    const anchored = toggle(emptySelection, 'b');
    const next = rangeTo(anchored, 'd', orderedIds);
    expect([...next.ids].sort()).toEqual(['b', 'c', 'd']);
  });

  it('anchor から target までの範囲を選択する（逆順でも同じ範囲）', () => {
    const anchored = toggle(emptySelection, 'd');
    const next = rangeTo(anchored, 'b', orderedIds);
    expect([...next.ids].sort()).toEqual(['b', 'c', 'd']);
  });

  it('anchor は更新しない（連続 Shift+クリックは常に同じ起点から）', () => {
    const anchored = toggle(emptySelection, 'b');
    const first = rangeTo(anchored, 'd', orderedIds);
    const second = rangeTo(first, 'a', orderedIds);
    expect(second.anchorId).toBe('b');
    expect([...second.ids].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('既存の選択に範囲を union する（既存選択は保持される）', () => {
    let state = toggle(emptySelection, 'e');
    state = toggle(state, 'a'); // anchor='a'
    const next = rangeTo(state, 'c', orderedIds);
    expect([...next.ids].sort()).toEqual(['a', 'b', 'c', 'e']);
  });

  it('anchor または target が一覧に無い場合は単一選択へ倒す', () => {
    const anchored = toggle(emptySelection, 'not-in-list');
    const next = rangeTo(anchored, 'c', orderedIds);
    expect([...next.ids]).toEqual(['c']);
    expect(next.anchorId).toBe('c');
  });
});

describe('selectAll（全件選択）', () => {
  it('全 id を選択し、anchor を先頭にする', () => {
    const next = selectAll(orderedIds);
    expect([...next.ids].sort()).toEqual([...orderedIds].sort());
    expect(next.anchorId).toBe('a');
  });

  it('空配列なら選択も anchor も空', () => {
    const next = selectAll([]);
    expect(next.ids.size).toBe(0);
    expect(next.anchorId).toBeNull();
  });
});

describe('clear（選択解除）', () => {
  it('空の選択状態を返す', () => {
    const next = clear();
    expect(next.ids.size).toBe(0);
    expect(next.anchorId).toBeNull();
  });
});

describe('isSelected', () => {
  it('選択中の id は true、それ以外は false', () => {
    const state = toggle(emptySelection, 'b');
    expect(isSelected(state, 'b')).toBe(true);
    expect(isSelected(state, 'a')).toBe(false);
  });
});
