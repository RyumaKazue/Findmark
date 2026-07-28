import { UNDO_WINDOW_MS, UndoManager } from './UndoManager.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UndoableAction } from './UndoManager.js';

const makeAction = (overrides: Partial<UndoableAction> = {}): UndoableAction => ({
  label: 'テストアクション',
  undo: vi.fn().mockResolvedValue(undefined),
  expiresAt: Date.now() + UNDO_WINDOW_MS,
  ...overrides,
});

describe('UndoManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('register_undoLatest_undoが1回実行され保持が解除される', async () => {
    const manager = new UndoManager();
    const action = makeAction();
    manager.register(action);

    await manager.undoLatest();

    expect(action.undo).toHaveBeenCalledTimes(1);
    expect(manager.peek()).toBeNull();
  });

  it('undoLatest_期限切れ後_undoを実行しない', async () => {
    const manager = new UndoManager();
    const action = makeAction();
    manager.register(action);

    vi.advanceTimersByTime(UNDO_WINDOW_MS + 1000);
    await manager.undoLatest();

    expect(action.undo).not.toHaveBeenCalled();
  });

  it('register_期限到達で自動破棄され購読者へnullが通知される', () => {
    const manager = new UndoManager();
    const listener = vi.fn();
    manager.subscribe(listener);
    listener.mockClear();

    const action = makeAction();
    manager.register(action);
    expect(listener).toHaveBeenLastCalledWith(action);

    vi.advanceTimersByTime(UNDO_WINDOW_MS + 1);
    expect(listener).toHaveBeenLastCalledWith(null);
    expect(manager.peek()).toBeNull();
  });

  it('register_2回登録_最新のみ保持される', async () => {
    const manager = new UndoManager();
    const first = makeAction({ label: '最初' });
    const second = makeAction({ label: '次' });

    manager.register(first);
    manager.register(second);

    expect(manager.peek()).toBe(second);

    await manager.undoLatest();
    expect(first.undo).not.toHaveBeenCalled();
    expect(second.undo).toHaveBeenCalledTimes(1);
  });

  it('subscribe_購読時に現在値を通知し解除後は通知されない', () => {
    const manager = new UndoManager();
    const action = makeAction();
    manager.register(action);

    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    expect(listener).toHaveBeenCalledWith(action);

    unsubscribe();
    listener.mockClear();
    manager.dismiss();
    expect(listener).not.toHaveBeenCalled();
  });

  it('undoLatest_undoがrejectしても保持が解除される', async () => {
    const manager = new UndoManager();
    const action = makeAction({ undo: vi.fn().mockRejectedValue(new Error('失敗')) });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    manager.register(action);

    await manager.undoLatest();

    expect(manager.peek()).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('dismiss_保持中のアクションを解除する', () => {
    const manager = new UndoManager();
    manager.register(makeAction());

    manager.dismiss();

    expect(manager.peek()).toBeNull();
  });

  it('undoLatest_未登録なら何もしない', async () => {
    const manager = new UndoManager();
    await expect(manager.undoLatest()).resolves.toBeUndefined();
  });
});
