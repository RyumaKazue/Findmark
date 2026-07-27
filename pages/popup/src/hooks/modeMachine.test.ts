import {
  initialModeState,
  isPrintableKey,
  isSearchFirstExempt,
  modeReducer,
  resolveKeyIntent,
  resolveListEscape,
  resolveShortcutIntent,
} from './modeMachine.js';
import { describe, expect, it } from 'vitest';
import type { Mode, ModeState } from './modeMachine.js';

const list: ModeState = { mode: 'LIST', targetId: null };

describe('modeReducer', () => {
  it('LIST から各モードへ遷移し targetId を保持する', () => {
    expect(modeReducer(list, { type: 'ENTER_INLINE_EDIT', targetId: 'b1' })).toEqual({
      mode: 'INLINE_EDIT',
      targetId: 'b1',
    });
    expect(modeReducer(list, { type: 'ENTER_ALIAS_EDIT', targetId: 'b2' })).toEqual({
      mode: 'ALIAS_EDIT',
      targetId: 'b2',
    });
    expect(modeReducer(list, { type: 'ENTER_PANEL' })).toEqual({ mode: 'PANEL', targetId: null });
    expect(modeReducer(list, { type: 'ENTER_DRAG', targetId: 'b3' })).toEqual({ mode: 'DRAG', targetId: 'b3' });
  });

  it('EXIT_TO_LIST で LIST / targetId=null に戻る', () => {
    const editing: ModeState = { mode: 'INLINE_EDIT', targetId: 'b1' };
    expect(modeReducer(editing, { type: 'EXIT_TO_LIST' })).toEqual(initialModeState);
  });

  it('非 LIST からの入口遷移は全 ENTER_* で現状維持に倒す（不正遷移防御）', () => {
    const editing: ModeState = { mode: 'INLINE_EDIT', targetId: 'b1' };
    expect(modeReducer(editing, { type: 'ENTER_PANEL' })).toBe(editing);
    expect(modeReducer(editing, { type: 'ENTER_ALIAS_EDIT', targetId: 'b9' })).toBe(editing);
    expect(modeReducer(editing, { type: 'ENTER_INLINE_EDIT', targetId: 'b9' })).toBe(editing);
    expect(modeReducer(editing, { type: 'ENTER_DRAG', targetId: 'b9' })).toBe(editing);
    const panel: ModeState = { mode: 'PANEL', targetId: null };
    expect(modeReducer(panel, { type: 'ENTER_DRAG', targetId: 'b9' })).toBe(panel);
  });

  it('LIST での EXIT_TO_LIST は同一 state を返す（no-op）', () => {
    expect(modeReducer(list, { type: 'EXIT_TO_LIST' })).toBe(list);
  });
});

describe('resolveKeyIntent', () => {
  it('LIST: ↑↓=選択移動 / Enter=開く / Escape=段階戻り起点', () => {
    expect(resolveKeyIntent('LIST', { key: 'ArrowDown' })).toBe('list:move-down');
    expect(resolveKeyIntent('LIST', { key: 'ArrowUp' })).toBe('list:move-up');
    expect(resolveKeyIntent('LIST', { key: 'Enter' })).toBe('list:open');
    expect(resolveKeyIntent('LIST', { key: 'Escape' })).toBe('list:escape');
    expect(resolveKeyIntent('LIST', { key: 'a' })).toBe('none');
  });

  it('LIST: Ctrl/⌘+Enter は開かない（新規タブは将来単位）', () => {
    expect(resolveKeyIntent('LIST', { key: 'Enter', ctrlKey: true })).toBe('none');
    expect(resolveKeyIntent('LIST', { key: 'Enter', metaKey: true })).toBe('none');
  });

  it('INLINE_EDIT: Enter=確定 / Escape=破棄 / ↑↓=none（ネイティブキャレット）', () => {
    expect(resolveKeyIntent('INLINE_EDIT', { key: 'Enter' })).toBe('inline:confirm');
    expect(resolveKeyIntent('INLINE_EDIT', { key: 'Escape' })).toBe('inline:discard');
    expect(resolveKeyIntent('INLINE_EDIT', { key: 'ArrowUp' })).toBe('none');
    expect(resolveKeyIntent('INLINE_EDIT', { key: 'ArrowDown' })).toBe('none');
  });

  it('ALIAS_EDIT: ↑↓=候補移動 / Enter=確定 / Escape=編集終了', () => {
    expect(resolveKeyIntent('ALIAS_EDIT', { key: 'ArrowUp' })).toBe('alias:candidate-up');
    expect(resolveKeyIntent('ALIAS_EDIT', { key: 'ArrowDown' })).toBe('alias:candidate-down');
    expect(resolveKeyIntent('ALIAS_EDIT', { key: 'Enter' })).toBe('alias:confirm');
    expect(resolveKeyIntent('ALIAS_EDIT', { key: 'Escape' })).toBe('alias:exit');
  });

  it('PANEL: ↑↓=候補移動 / Enter=決定 / Escape=閉じる', () => {
    expect(resolveKeyIntent('PANEL', { key: 'ArrowUp' })).toBe('panel:candidate-up');
    expect(resolveKeyIntent('PANEL', { key: 'ArrowDown' })).toBe('panel:candidate-down');
    expect(resolveKeyIntent('PANEL', { key: 'Enter' })).toBe('panel:confirm');
    expect(resolveKeyIntent('PANEL', { key: 'Escape' })).toBe('panel:close');
  });

  it('DRAG: Escape=中止のみ、↑↓/Enter は無効', () => {
    expect(resolveKeyIntent('DRAG', { key: 'Escape' })).toBe('drag:cancel');
    expect(resolveKeyIntent('DRAG', { key: 'ArrowDown' })).toBe('none');
    expect(resolveKeyIntent('DRAG', { key: 'ArrowUp' })).toBe('none');
    expect(resolveKeyIntent('DRAG', { key: 'Enter' })).toBe('none');
  });

  it('全モードで未定義キーは none', () => {
    const modes: Mode[] = ['LIST', 'INLINE_EDIT', 'ALIAS_EDIT', 'PANEL', 'DRAG'];
    for (const m of modes) {
      expect(resolveKeyIntent(m, { key: 'x' })).toBe('none');
    }
  });
});

describe('resolveListEscape', () => {
  it('キーワードあり → clear-keyword（スコープ有無に依らず優先）', () => {
    expect(resolveListEscape({ hasQuery: true, hasScope: false })).toBe('clear-keyword');
    expect(resolveListEscape({ hasQuery: true, hasScope: true })).toBe('clear-keyword');
  });

  it('キーワードなし & スコープあり → clear-scope', () => {
    expect(resolveListEscape({ hasQuery: false, hasScope: true })).toBe('clear-scope');
  });

  it('どちらもなし → close', () => {
    expect(resolveListEscape({ hasQuery: false, hasScope: false })).toBe('close');
  });
});

describe('isPrintableKey', () => {
  it('単一文字（ASCII/日本語/スペース）は印字とみなす', () => {
    expect(isPrintableKey({ key: 'a' })).toBe(true);
    expect(isPrintableKey({ key: 'あ' })).toBe(true);
    expect(isPrintableKey({ key: ' ' })).toBe(true);
  });

  it('修飾キー付きは印字としない', () => {
    expect(isPrintableKey({ key: 'a', ctrlKey: true })).toBe(false);
    expect(isPrintableKey({ key: 'a', metaKey: true })).toBe(false);
    expect(isPrintableKey({ key: 'a', altKey: true })).toBe(false);
  });

  it('機能キーは印字としない', () => {
    expect(isPrintableKey({ key: 'Enter' })).toBe(false);
    expect(isPrintableKey({ key: 'ArrowDown' })).toBe(false);
    expect(isPrintableKey({ key: 'Tab' })).toBe(false);
    expect(isPrintableKey({ key: 'Escape' })).toBe(false);
  });

  it('IME 変換中は印字としない', () => {
    expect(isPrintableKey({ key: 'a', isComposing: true })).toBe(false);
  });
});

describe('isSearchFirstExempt', () => {
  it('自前の文字入力 UI を持つモード（編集/別名/パネル）は検索ファースト対象外', () => {
    expect(isSearchFirstExempt('INLINE_EDIT')).toBe(true);
    expect(isSearchFirstExempt('ALIAS_EDIT')).toBe(true);
    expect(isSearchFirstExempt('PANEL')).toBe(true);
  });

  it('LIST / DRAG は検索ファーストの対象', () => {
    expect(isSearchFirstExempt('LIST')).toBe(false);
    expect(isSearchFirstExempt('DRAG')).toBe(false);
  });
});

describe('resolveShortcutIntent', () => {
  it('F2 / Ctrl(⌘)+E → inline-edit', () => {
    expect(resolveShortcutIntent({ key: 'F2' })).toBe('inline-edit');
    expect(resolveShortcutIntent({ key: 'e', ctrlKey: true })).toBe('inline-edit');
    expect(resolveShortcutIntent({ key: 'E', metaKey: true })).toBe('inline-edit');
  });

  it('Ctrl(⌘)+; → alias-edit', () => {
    expect(resolveShortcutIntent({ key: ';', ctrlKey: true })).toBe('alias-edit');
  });

  it('Ctrl(⌘)+M → panel', () => {
    expect(resolveShortcutIntent({ key: 'm', ctrlKey: true })).toBe('panel');
    expect(resolveShortcutIntent({ key: 'M', metaKey: true })).toBe('panel');
  });

  it('修飾なしの letter や無関係キーは null', () => {
    expect(resolveShortcutIntent({ key: 'e' })).toBeNull();
    expect(resolveShortcutIntent({ key: 'm' })).toBeNull();
    expect(resolveShortcutIntent({ key: 'a', ctrlKey: true })).toBeNull();
    expect(resolveShortcutIntent({ key: 'e', ctrlKey: true, altKey: true })).toBeNull();
  });
});
