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
    expect(typeof localStateStore.expandFolders).toBe('function');
    expect(typeof localStateStore.initializeExpanded).toBe('function');
    expect(typeof localStateStore.saveSession).toBe('function');
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

  it('toggleExpanded が初期化済みフラグを立てる', async () => {
    await localStateStore.set({ expandedFolderIds: [] });
    await localStateStore.toggleExpanded('f1');
    expect(localStateStore.getSnapshot()?.isExpandedInitialized).toBe(true);
  });

  it('expandFolders が既存を保ちつつ ID 群を追加する（重複しない）', async () => {
    await localStateStore.set({ expandedFolderIds: ['a'] });
    await localStateStore.expandFolders(['a', 'b', 'c']);
    expect(localStateStore.getSnapshot()?.expandedFolderIds).toEqual(['a', 'b', 'c']);
  });

  it('expandFolders は空配列で何もしない', async () => {
    await localStateStore.set({ expandedFolderIds: ['a'] });
    await localStateStore.expandFolders([]);
    expect(localStateStore.getSnapshot()?.expandedFolderIds).toEqual(['a']);
  });

  it('initializeExpanded は初回のみ既定展開を書き込む', async () => {
    await localStateStore.set({ expandedFolderIds: [] });
    await localStateStore.initializeExpanded(['root-1', 'root-2']);
    expect(localStateStore.getSnapshot()?.expandedFolderIds).toEqual(['root-1', 'root-2']);
    expect(localStateStore.getSnapshot()?.isExpandedInitialized).toBe(true);
  });

  it('initializeExpanded は2回目以降は何もしない（全て畳んだ状態を保持）', async () => {
    await localStateStore.set({ expandedFolderIds: [] });
    await localStateStore.initializeExpanded(['root-1']);
    // ユーザーが全て畳む
    await localStateStore.set({ expandedFolderIds: [], isExpandedInitialized: true });
    await localStateStore.initializeExpanded(['root-1']);
    expect(localStateStore.getSnapshot()?.expandedFolderIds).toEqual([]);
  });

  it('saveSession は session フィールドのみ更新し他フィールドを保つ（U19）', async () => {
    await localStateStore.set({ expandedFolderIds: ['a'], lastUsedFolderId: 'f9' });
    await localStateStore.saveSession({
      focusArea: 'result',
      scopeFolderId: 'f1',
      selectedBookmarkId: 'b2',
      query: 'foo',
    });
    const snap = localStateStore.getSnapshot();
    expect(snap?.expandedFolderIds).toEqual(['a']);
    expect(snap?.lastUsedFolderId).toBe('f9');
    expect(snap?.session).toEqual({ focusArea: 'result', scopeFolderId: 'f1', selectedBookmarkId: 'b2', query: 'foo' });
  });
});
