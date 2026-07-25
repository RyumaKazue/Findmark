import { localStateStore } from './localStateStore.js';
import { settingsStore } from './settingsStore.js';
import { describe, expect, it } from 'vitest';

// SettingsStore / LocalStateStore は既存基盤 createStorage の薄いラッパのため、
// 既定値の取得と公開 API の形（利便メソッドの存在）をスモーク的に検証する。
// chrome 未定義環境では createStorage の get() は fallback（既定値）を返す。

describe('settingsStore', () => {
  it('既定の UserSettings（trashRetentionDays=30）を返す', async () => {
    expect(await settingsStore.get()).toEqual({ trashRetentionDays: 30 });
  });

  it('公開 API（get/set + 利便メソッド）を備える', () => {
    expect(typeof settingsStore.get).toBe('function');
    expect(typeof settingsStore.set).toBe('function');
    expect(typeof settingsStore.setRetentionDays).toBe('function');
    expect(typeof settingsStore.setLocale).toBe('function');
  });

  it('setRetentionDays / setLocale が該当フィールドのみ更新する', async () => {
    await settingsStore.set({ trashRetentionDays: 30 });
    await settingsStore.setRetentionDays(7);
    expect(settingsStore.getSnapshot()).toEqual({ trashRetentionDays: 7 });
    await settingsStore.setLocale('en');
    expect(settingsStore.getSnapshot()).toEqual({ trashRetentionDays: 7, locale: 'en' });
  });
});

describe('localStateStore', () => {
  it('既定の LocalState（expandedFolderIds=[]）を返す', async () => {
    expect(await localStateStore.get()).toEqual({ expandedFolderIds: [] });
  });

  it('公開 API（get/set + 利便メソッド）を備える', () => {
    expect(typeof localStateStore.get).toBe('function');
    expect(typeof localStateStore.set).toBe('function');
    expect(typeof localStateStore.setLastUsedFolder).toBe('function');
    expect(typeof localStateStore.toggleExpanded).toBe('function');
  });

  it('toggleExpanded が展開状態を追加/削除する', async () => {
    await localStateStore.set({ expandedFolderIds: [] });
    await localStateStore.toggleExpanded('f1');
    expect(localStateStore.getSnapshot()?.expandedFolderIds).toEqual(['f1']);
    await localStateStore.toggleExpanded('f1');
    expect(localStateStore.getSnapshot()?.expandedFolderIds).toEqual([]);
  });

  it('setLastUsedFolder が前回フォルダを記録する', async () => {
    await localStateStore.set({ expandedFolderIds: [] });
    await localStateStore.setLastUsedFolder('folder-9');
    expect(localStateStore.getSnapshot()?.lastUsedFolderId).toBe('folder-9');
  });
});
