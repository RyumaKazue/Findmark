import { syncShortcutAvailability } from './commands.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShortcutDeps } from './commands.js';

// `chrome.commands` は最小契約 DI で受け取るため、chrome API のスタブは不要（モックを直接注入する）。

describe('syncShortcutAvailability', () => {
  let deps: ShortcutDeps & {
    commands: { getAll: ReturnType<typeof vi.fn> };
    localState: { setShortcutUnassigned: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    deps = {
      commands: { getAll: vi.fn(async () => [{ name: '_execute_action', shortcut: 'Ctrl+Shift+F' }]) },
      localState: { setShortcutUnassigned: vi.fn(async () => undefined) },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncShortcutAvailability_shortcutが空_未割り当てとして記録される', async () => {
    // 他拡張に Ctrl+Shift+F を先に取られた場合、Chrome は shortcut を空文字で返す。
    deps.commands.getAll.mockResolvedValue([{ name: '_execute_action', shortcut: '' }]);

    await syncShortcutAvailability(deps);

    expect(deps.localState.setShortcutUnassigned).toHaveBeenCalledWith(true);
  });

  it('syncShortcutAvailability_shortcut割り当て済み_falseへ戻る', async () => {
    await syncShortcutAvailability(deps);

    expect(deps.localState.setShortcutUnassigned).toHaveBeenCalledWith(false);
  });

  it('syncShortcutAvailability_コマンドが見つからない_未割り当てとして記録される', async () => {
    deps.commands.getAll.mockResolvedValue([{ name: 'other-command', shortcut: 'Ctrl+K' }]);

    await syncShortcutAvailability(deps);

    expect(deps.localState.setShortcutUnassigned).toHaveBeenCalledWith(true);
  });

  it('syncShortcutAvailability_getAllが失敗_例外を投げずconsole.errorが出る', async () => {
    deps.commands.getAll.mockRejectedValue(new Error('commands 取得失敗'));

    await expect(syncShortcutAvailability(deps)).resolves.toBeUndefined();

    expect(deps.localState.setShortcutUnassigned).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});
