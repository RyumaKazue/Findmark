import {
  activate,
  clear,
  deactivate,
  emptySelection,
  isSelected,
  rangeTo,
  selectAll,
  toggle,
  toggleActive,
} from './selectionModel.js';
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
  it('選択と anchor を空にする', () => {
    const next = clear(toggle(emptySelection, 'b'));
    expect(next.ids.size).toBe(0);
    expect(next.anchorId).toBeNull();
  });

  it('選択モードは保つ（クエリ/スコープ変更で選び直せるようにする）', () => {
    const next = clear(toggle(emptySelection, 'b'));
    expect(next.active).toBe(true);
  });

  it('通常モードで呼んでも通常モードのまま', () => {
    expect(clear(emptySelection).active).toBe(false);
  });
});

describe('isSelected', () => {
  it('選択中の id は true、それ以外は false', () => {
    const state = toggle(emptySelection, 'b');
    expect(isSelected(state, 'b')).toBe(true);
    expect(isSelected(state, 'a')).toBe(false);
  });
});

describe('選択モード（active）', () => {
  it('初期状態は通常モード', () => {
    expect(emptySelection.active).toBe(false);
  });

  it('activate は選択を保ったままモードに入る', () => {
    const next = activate({ ids: new Set(['a', 'b']), anchorId: 'a', active: false });
    expect(next.active).toBe(true);
    expect([...next.ids].sort()).toEqual(['a', 'b']);
    expect(next.anchorId).toBe('a');
  });

  it('activate は既にモード中なら同一参照を返す（無用な再レンダーを避ける）', () => {
    const active = activate(emptySelection);
    expect(activate(active)).toBe(active);
  });

  it('deactivate は選択・anchor・モードをすべて初期化する', () => {
    const next = deactivate();
    expect(next.ids.size).toBe(0);
    expect(next.anchorId).toBeNull();
    expect(next.active).toBe(false);
  });

  it('toggleActive は OFF→ON で選択を保持する', () => {
    const next = toggleActive(emptySelection);
    expect(next.active).toBe(true);
  });

  it('toggleActive は ON→OFF で選択も捨てる', () => {
    const selected = toggle(emptySelection, 'b');
    const next = toggleActive(selected);
    expect(next.active).toBe(false);
    expect(next.ids.size).toBe(0);
  });
});

describe('不変条件: 選択があるなら必ず選択モード', () => {
  it('toggle は通常モードからでもモードへ入る（Ctrl/Cmd+クリック）', () => {
    const next = toggle(emptySelection, 'b');
    expect(next.active).toBe(true);
  });

  it('rangeTo は通常モードからでもモードへ入る（Shift+クリック）', () => {
    expect(rangeTo(emptySelection, 'c', orderedIds).active).toBe(true);
    const anchored = toggle(emptySelection, 'b');
    expect(rangeTo(anchored, 'd', orderedIds).active).toBe(true);
  });

  it('selectAll は通常モードからでもモードへ入る（Ctrl/Cmd+A）', () => {
    expect(selectAll(orderedIds).active).toBe(true);
  });

  it('最後の1件を外して0件になってもモードは維持する（次のクリックが「開く」に化けない）', () => {
    const selected = toggle(emptySelection, 'b');
    const next = toggle(selected, 'b');
    expect(next.ids.size).toBe(0);
    expect(next.active).toBe(true);
  });

  it('どの操作の後も ids が非空なら active は true', () => {
    const states = [
      toggle(emptySelection, 'b'),
      rangeTo(toggle(emptySelection, 'b'), 'd', orderedIds),
      selectAll(orderedIds),
      clear(selectAll(orderedIds)),
      activate(emptySelection),
      deactivate(),
    ];
    // 選択が残っている状態だけを見る（空になる操作は不変条件の対象外＝モードの有無を問わない）。
    for (const state of states.filter(s => s.ids.size > 0)) {
      expect(state.active).toBe(true);
    }
  });
});
