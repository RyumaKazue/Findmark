import {
  initialModeState,
  isPrintableKey,
  isSearchFirstExempt,
  isSearchFirstTriggerKey,
  modeReducer,
  resolveEscapeStep,
  resolveKeyIntent,
  resolveShortcutIntent,
  toFocusArea,
} from './modeMachine.js';
import { describe, expect, it } from 'vitest';
import type { Mode, ModeState } from './modeMachine.js';

const list: ModeState = { mode: 'LIST', targetId: null };
const folderTree: ModeState = { mode: 'FOLDER_TREE', targetId: null };

describe('modeReducer', () => {
  it('LIST から各モードへ遷移し targetId を保持する', () => {
    expect(modeReducer(list, { type: 'ENTER_FOLDER_TREE' })).toEqual({ mode: 'FOLDER_TREE', targetId: null });
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

  it('EXIT_TO_LIST で LIST / targetId=null に戻る（FOLDER_TREE からも戻れる）', () => {
    const editing: ModeState = { mode: 'INLINE_EDIT', targetId: 'b1' };
    expect(modeReducer(editing, { type: 'EXIT_TO_LIST' })).toEqual(initialModeState);
    expect(modeReducer(folderTree, { type: 'EXIT_TO_LIST' })).toEqual(initialModeState);
  });

  it('非 LIST からの入口遷移は全 ENTER_* で現状維持に倒す（不正遷移防御）', () => {
    const editing: ModeState = { mode: 'INLINE_EDIT', targetId: 'b1' };
    expect(modeReducer(editing, { type: 'ENTER_FOLDER_TREE' })).toBe(editing);
    expect(modeReducer(editing, { type: 'ENTER_PANEL' })).toBe(editing);
    expect(modeReducer(editing, { type: 'ENTER_ALIAS_EDIT', targetId: 'b9' })).toBe(editing);
    expect(modeReducer(editing, { type: 'ENTER_INLINE_EDIT', targetId: 'b9' })).toBe(editing);
    expect(modeReducer(editing, { type: 'ENTER_DRAG', targetId: 'b9' })).toBe(editing);
    const panel: ModeState = { mode: 'PANEL', targetId: null };
    expect(modeReducer(panel, { type: 'ENTER_DRAG', targetId: 'b9' })).toBe(panel);
    // FOLDER_TREE からも他モードへ直接遷移できない（LIST 経由が必須）。
    expect(modeReducer(folderTree, { type: 'ENTER_INLINE_EDIT', targetId: 'b9' })).toBe(folderTree);
    expect(modeReducer(folderTree, { type: 'ENTER_FOLDER_TREE' })).toBe(folderTree);
  });

  it('LIST での EXIT_TO_LIST は同一 state を返す（no-op）', () => {
    expect(modeReducer(list, { type: 'EXIT_TO_LIST' })).toBe(list);
  });
});

describe('toFocusArea', () => {
  it('LIST + search → search', () => {
    expect(toFocusArea('LIST', 'search')).toBe('search');
  });

  it('LIST + result → result', () => {
    expect(toFocusArea('LIST', 'result')).toBe('result');
  });

  it('FOLDER_TREE → folderTree（listFocus に依らない）', () => {
    expect(toFocusArea('FOLDER_TREE', 'search')).toBe('folderTree');
    expect(toFocusArea('FOLDER_TREE', 'result')).toBe('folderTree');
  });
});

describe('resolveKeyIntent', () => {
  it('LIST + search: ↑↓=検索欄離脱しつつ選択行移動 / Enter=開く / Escape=段階戻り起点', () => {
    expect(resolveKeyIntent('LIST', { key: 'ArrowDown' }, 'search')).toBe('list:leave-search-down');
    expect(resolveKeyIntent('LIST', { key: 'ArrowUp' }, 'search')).toBe('list:leave-search-up');
    expect(resolveKeyIntent('LIST', { key: 'Enter' }, 'search')).toBe('list:open');
    expect(resolveKeyIntent('LIST', { key: 'Escape' }, 'search')).toBe('escape:step-back');
    expect(resolveKeyIntent('LIST', { key: 'a' }, 'search')).toBe('none');
  });

  it('LIST + search: ←→ と Home は none（キャレット移動・クエリ途中の修正を温存する）', () => {
    expect(resolveKeyIntent('LIST', { key: 'ArrowLeft' }, 'search')).toBe('none');
    expect(resolveKeyIntent('LIST', { key: 'ArrowRight' }, 'search')).toBe('none');
    expect(resolveKeyIntent('LIST', { key: 'Home' }, 'search')).toBe('none');
  });

  it('LIST + result: ↑↓=選択移動 / ←=左ペインへ / →=none / Enter=開く / Escape=段階戻り起点', () => {
    expect(resolveKeyIntent('LIST', { key: 'ArrowDown' }, 'result')).toBe('list:move-down');
    expect(resolveKeyIntent('LIST', { key: 'ArrowUp' }, 'result')).toBe('list:move-up');
    expect(resolveKeyIntent('LIST', { key: 'ArrowLeft' }, 'result')).toBe('list:to-folder-tree');
    expect(resolveKeyIntent('LIST', { key: 'ArrowRight' }, 'result')).toBe('none');
    expect(resolveKeyIntent('LIST', { key: 'Enter' }, 'result')).toBe('list:open');
    expect(resolveKeyIntent('LIST', { key: 'Escape' }, 'result')).toBe('escape:step-back');
  });

  it('LIST: Ctrl/⌘+Enter は開かない（新規タブは将来単位）', () => {
    expect(resolveKeyIntent('LIST', { key: 'Enter', ctrlKey: true }, 'search')).toBe('none');
    expect(resolveKeyIntent('LIST', { key: 'Enter', metaKey: true }, 'result')).toBe('none');
  });

  it('FOLDER_TREE: ↑↓=フォルダ移動 / ←=親へ / →=右ペインへ / Enter=展開トグル / Home=すべてへ / Escape=段階戻り起点', () => {
    expect(resolveKeyIntent('FOLDER_TREE', { key: 'ArrowDown' }, 'search')).toBe('folder:move-down');
    expect(resolveKeyIntent('FOLDER_TREE', { key: 'ArrowUp' }, 'search')).toBe('folder:move-up');
    expect(resolveKeyIntent('FOLDER_TREE', { key: 'ArrowLeft' }, 'search')).toBe('folder:parent');
    expect(resolveKeyIntent('FOLDER_TREE', { key: 'ArrowRight' }, 'search')).toBe('folder:to-result');
    expect(resolveKeyIntent('FOLDER_TREE', { key: 'Enter' }, 'search')).toBe('folder:toggle-expand');
    expect(resolveKeyIntent('FOLDER_TREE', { key: 'Home' }, 'search')).toBe('folder:home');
    expect(resolveKeyIntent('FOLDER_TREE', { key: 'Escape' }, 'search')).toBe('escape:step-back');
    expect(resolveKeyIntent('FOLDER_TREE', { key: 'x' }, 'search')).toBe('none');
  });

  it('INLINE_EDIT: Enter=確定 / Escape=破棄 / ↑↓=none（ネイティブキャレット）', () => {
    expect(resolveKeyIntent('INLINE_EDIT', { key: 'Enter' }, 'search')).toBe('inline:confirm');
    expect(resolveKeyIntent('INLINE_EDIT', { key: 'Escape' }, 'search')).toBe('inline:discard');
    expect(resolveKeyIntent('INLINE_EDIT', { key: 'ArrowUp' }, 'search')).toBe('none');
    expect(resolveKeyIntent('INLINE_EDIT', { key: 'ArrowDown' }, 'search')).toBe('none');
  });

  it('INLINE_EDIT: listFocus を省略しても同じ結果になる（U10・第3引数は LIST 以外で未参照）', () => {
    expect(resolveKeyIntent('INLINE_EDIT', { key: 'Enter' })).toBe('inline:confirm');
    expect(resolveKeyIntent('INLINE_EDIT', { key: 'Escape' })).toBe('inline:discard');
    expect(resolveKeyIntent('INLINE_EDIT', { key: 'ArrowUp' })).toBe('none');
  });

  it('ALIAS_EDIT: ↑↓=候補移動 / Enter=確定 / Escape=編集終了', () => {
    expect(resolveKeyIntent('ALIAS_EDIT', { key: 'ArrowUp' }, 'search')).toBe('alias:candidate-up');
    expect(resolveKeyIntent('ALIAS_EDIT', { key: 'ArrowDown' }, 'search')).toBe('alias:candidate-down');
    expect(resolveKeyIntent('ALIAS_EDIT', { key: 'Enter' }, 'search')).toBe('alias:confirm');
    expect(resolveKeyIntent('ALIAS_EDIT', { key: 'Escape' }, 'search')).toBe('alias:exit');
  });

  it('PANEL: ↑↓=候補移動 / Enter=決定 / Escape=閉じる', () => {
    expect(resolveKeyIntent('PANEL', { key: 'ArrowUp' }, 'search')).toBe('panel:candidate-up');
    expect(resolveKeyIntent('PANEL', { key: 'ArrowDown' }, 'search')).toBe('panel:candidate-down');
    expect(resolveKeyIntent('PANEL', { key: 'Enter' }, 'search')).toBe('panel:confirm');
    expect(resolveKeyIntent('PANEL', { key: 'Escape' }, 'search')).toBe('panel:close');
  });

  it('DRAG: Escape=中止のみ、↑↓/Enter は無効', () => {
    expect(resolveKeyIntent('DRAG', { key: 'Escape' }, 'search')).toBe('drag:cancel');
    expect(resolveKeyIntent('DRAG', { key: 'ArrowDown' }, 'search')).toBe('none');
    expect(resolveKeyIntent('DRAG', { key: 'ArrowUp' }, 'search')).toBe('none');
    expect(resolveKeyIntent('DRAG', { key: 'Enter' }, 'search')).toBe('none');
  });

  it('全モードで未定義キーは none', () => {
    const modes: Mode[] = ['LIST', 'FOLDER_TREE', 'INLINE_EDIT', 'ALIAS_EDIT', 'PANEL', 'DRAG'];
    for (const m of modes) {
      expect(resolveKeyIntent(m, { key: 'x' }, 'search')).toBe('none');
    }
  });
});

describe('resolveEscapeStep', () => {
  it('検索ボックス以外にフォーカス → focus-search（キーワード/スコープより優先）', () => {
    expect(resolveEscapeStep({ focusArea: 'result', hasQuery: true, hasScope: true })).toBe('focus-search');
    expect(resolveEscapeStep({ focusArea: 'folderTree', hasQuery: false, hasScope: false })).toBe('focus-search');
  });

  it('検索ボックス + キーワードあり → clear-keyword（スコープ有無に依らず優先）', () => {
    expect(resolveEscapeStep({ focusArea: 'search', hasQuery: true, hasScope: false })).toBe('clear-keyword');
    expect(resolveEscapeStep({ focusArea: 'search', hasQuery: true, hasScope: true })).toBe('clear-keyword');
  });

  it('検索ボックス + キーワードなし & スコープあり → clear-scope', () => {
    expect(resolveEscapeStep({ focusArea: 'search', hasQuery: false, hasScope: true })).toBe('clear-scope');
  });

  it('検索ボックス + どちらもなし → close', () => {
    expect(resolveEscapeStep({ focusArea: 'search', hasQuery: false, hasScope: false })).toBe('close');
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

describe('isSearchFirstTriggerKey', () => {
  it('印字文字はトリガーになる（isPrintableKey と同じ判定を内包）', () => {
    expect(isSearchFirstTriggerKey({ key: 'a' })).toBe(true);
    expect(isSearchFirstTriggerKey({ key: 'あ' })).toBe(true);
  });

  it('修飾なしの Backspace はトリガーになる', () => {
    expect(isSearchFirstTriggerKey({ key: 'Backspace' })).toBe(true);
  });

  it('修飾キー付き Backspace はトリガーにしない', () => {
    expect(isSearchFirstTriggerKey({ key: 'Backspace', ctrlKey: true })).toBe(false);
    expect(isSearchFirstTriggerKey({ key: 'Backspace', metaKey: true })).toBe(false);
    expect(isSearchFirstTriggerKey({ key: 'Backspace', altKey: true })).toBe(false);
  });

  it('IME 変換中の Backspace はトリガーにしない', () => {
    expect(isSearchFirstTriggerKey({ key: 'Backspace', isComposing: true })).toBe(false);
  });

  it('Backspace 以外の機能キーはトリガーにしない', () => {
    expect(isSearchFirstTriggerKey({ key: 'Enter' })).toBe(false);
    expect(isSearchFirstTriggerKey({ key: 'ArrowDown' })).toBe(false);
    expect(isSearchFirstTriggerKey({ key: 'Delete' })).toBe(false);
    expect(isSearchFirstTriggerKey({ key: 'Tab' })).toBe(false);
  });
});

describe('isSearchFirstExempt', () => {
  it('自前の文字入力 UI を持つモード（編集/別名/パネル）は検索ファースト対象外', () => {
    expect(isSearchFirstExempt('INLINE_EDIT')).toBe(true);
    expect(isSearchFirstExempt('ALIAS_EDIT')).toBe(true);
    expect(isSearchFirstExempt('PANEL')).toBe(true);
  });

  it('LIST / DRAG / FOLDER_TREE は検索ファーストの対象（対象外にしない）', () => {
    expect(isSearchFirstExempt('LIST')).toBe(false);
    expect(isSearchFirstExempt('DRAG')).toBe(false);
    expect(isSearchFirstExempt('FOLDER_TREE')).toBe(false);
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

  it('修飾なしの Delete → delete（U10）', () => {
    expect(resolveShortcutIntent({ key: 'Delete' })).toBe('delete');
  });

  it('修飾付きの Delete は delete にしない', () => {
    expect(resolveShortcutIntent({ key: 'Delete', ctrlKey: true })).toBeNull();
    expect(resolveShortcutIntent({ key: 'Delete', metaKey: true })).toBeNull();
    expect(resolveShortcutIntent({ key: 'Delete', altKey: true })).toBeNull();
    expect(resolveShortcutIntent({ key: 'Delete', shiftKey: true })).toBeNull();
  });

  it('Ctrl(⌘)+Z → undo（U10）', () => {
    expect(resolveShortcutIntent({ key: 'z', ctrlKey: true })).toBe('undo');
    expect(resolveShortcutIntent({ key: 'Z', metaKey: true })).toBe('undo');
  });

  it('Ctrl(⌘)+Shift+Z は undo にしない（やり直しは未定義）', () => {
    expect(resolveShortcutIntent({ key: 'z', ctrlKey: true, shiftKey: true })).toBeNull();
    expect(resolveShortcutIntent({ key: 'Z', metaKey: true, shiftKey: true })).toBeNull();
  });
});
