import { collectLiveIds, pruneLocalState, runStartupCleanup, selectOrphanAliasUrls } from './cleanup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CleanupDeps } from './cleanup.js';
import type { AliasRecord, BookmarkNode, LocalState } from '@extension/storage';

// クリーンアップの判定ロジックは純粋関数のため chrome API を必要としない。`runStartupCleanup` は
// 最小契約 DI で外部依存を受け取るため、モックを注入して検証する（storage 側テストと同じモック方針）。

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-14T00:00:00Z').getTime();

/** 「バー配下にフォルダ Dev、その中にブックマーク2件」の典型ツリー。 */
const tree = (): BookmarkNode[] => [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        parentId: '0',
        title: 'ブックマーク バー',
        children: [
          {
            id: '10',
            parentId: '1',
            title: 'Dev',
            children: [{ id: '100', parentId: '10', title: 'A', url: 'https://ex.com/a' }],
          },
          { id: '11', parentId: '1', title: 'B', url: 'https://ex.com/b' },
        ],
      },
    ],
  },
];

const aliasRecord = (overrides: Partial<AliasRecord> = {}): AliasRecord => ({
  urlHash: 'hash-a',
  url: 'https://ex.com/a',
  aliases: ['えー'],
  updatedAt: NOW - 100 * DAY_MS,
  ...overrides,
});

describe('collectLiveIds', () => {
  it('collectLiveIds_入れ子ツリー_フォルダとブックマークを再帰収集する', () => {
    const live = collectLiveIds(tree());

    expect([...live.folderIds].sort()).toEqual(['0', '1', '10']);
    expect([...live.bookmarkIds].sort()).toEqual(['100', '11']);
    expect(live.urls.sort()).toEqual(['https://ex.com/a', 'https://ex.com/b']);
  });

  it('collectLiveIds_空配列_空の集合を返す', () => {
    const live = collectLiveIds([]);

    expect(live.folderIds.size).toBe(0);
    expect(live.bookmarkIds.size).toBe(0);
    expect(live.urls).toEqual([]);
  });
});

describe('pruneLocalState', () => {
  const live = collectLiveIds(tree());

  it('pruneLocalState_存在しないフォルダID_expandedFolderIdsから除去される', () => {
    const state: LocalState = { expandedFolderIds: ['1', '999', '10'] };

    expect(pruneLocalState(state, live)?.expandedFolderIds).toEqual(['1', '10']);
  });

  it('pruneLocalState_存在しないlastUsedFolderId_クリアされる', () => {
    const state: LocalState = { expandedFolderIds: [], lastUsedFolderId: '999' };

    const pruned = pruneLocalState(state, live);

    expect(pruned).not.toBeNull();
    expect(pruned).not.toHaveProperty('lastUsedFolderId');
  });

  it('pruneLocalState_存在しないscopeFolderId_nullへ戻る', () => {
    const state: LocalState = {
      expandedFolderIds: [],
      session: { focusArea: 'folderTree', scopeFolderId: '999', query: 'q' },
    };

    const pruned = pruneLocalState(state, live);

    expect(pruned?.session?.scopeFolderId).toBeNull();
    // 他のセッション項目は保持する。
    expect(pruned?.session?.focusArea).toBe('folderTree');
    expect(pruned?.session?.query).toBe('q');
  });

  it('pruneLocalState_存在しないselectedBookmarkId_キーごと削除される', () => {
    const state: LocalState = {
      expandedFolderIds: [],
      session: { focusArea: 'result', scopeFolderId: null, selectedBookmarkId: '999', query: '' },
    };

    const pruned = pruneLocalState(state, live);

    expect(pruned?.session).not.toHaveProperty('selectedBookmarkId');
  });

  it('pruneLocalState_ブックマークIDをフォルダIDと取り違えない', () => {
    // '100' はブックマークなので、フォルダの展開状態としては無効。
    const state: LocalState = { expandedFolderIds: ['100'] };

    expect(pruneLocalState(state, live)?.expandedFolderIds).toEqual([]);
  });

  it('pruneLocalState_全参照が現存_nullを返す', () => {
    const state: LocalState = {
      expandedFolderIds: ['1', '10'],
      lastUsedFolderId: '10',
      session: { focusArea: 'result', scopeFolderId: '10', selectedBookmarkId: '100', query: 'a' },
    };

    expect(pruneLocalState(state, live)).toBeNull();
  });

  it('pruneLocalState_元のstateを破壊しない', () => {
    const state: LocalState = { expandedFolderIds: ['1', '999'], lastUsedFolderId: '999' };

    pruneLocalState(state, live);

    expect(state.expandedFolderIds).toEqual(['1', '999']);
    expect(state.lastUsedFolderId).toBe('999');
  });
});

describe('selectOrphanAliasUrls', () => {
  it('selectOrphanAliasUrls_現存URLのレコード_削除対象にならない', () => {
    const records = [aliasRecord()];

    expect(selectOrphanAliasUrls(records, new Set(['hash-a']), NOW)).toEqual([]);
  });

  it('selectOrphanAliasUrls_猶予期間内の孤立レコード_削除対象にならない', () => {
    const records = [aliasRecord({ updatedAt: NOW - 29 * DAY_MS })];

    expect(selectOrphanAliasUrls(records, new Set(), NOW)).toEqual([]);
  });

  it('selectOrphanAliasUrls_猶予期間超過の孤立レコード_削除対象になる', () => {
    const records = [aliasRecord({ updatedAt: NOW - 31 * DAY_MS })];

    expect(selectOrphanAliasUrls(records, new Set(), NOW)).toEqual(['https://ex.com/a']);
  });

  it('selectOrphanAliasUrls_猶予期間を明示_その期間で判定する', () => {
    const records = [aliasRecord({ updatedAt: NOW - 2 * DAY_MS })];

    expect(selectOrphanAliasUrls(records, new Set(), NOW, DAY_MS)).toEqual(['https://ex.com/a']);
  });
});

describe('runStartupCleanup', () => {
  let deps: CleanupDeps & {
    bookmarks: { getTree: ReturnType<typeof vi.fn> };
    aliases: { getAll: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
    localState: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
    settings: { get: ReturnType<typeof vi.fn> };
    trash: { purgeExpired: ReturnType<typeof vi.fn>; enforceLimits: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    deps = {
      bookmarks: { getTree: vi.fn(async () => tree()) },
      aliases: { getAll: vi.fn(async () => new Map<string, AliasRecord>()), remove: vi.fn(async () => undefined) },
      localState: {
        get: vi.fn(async (): Promise<LocalState> => ({ expandedFolderIds: ['1'] })),
        set: vi.fn(async () => undefined),
      },
      settings: { get: vi.fn(async () => ({ trashRetentionDays: 30 })) },
      trash: { purgeExpired: vi.fn(async () => 0), enforceLimits: vi.fn(async () => 0) },
      // 実 Normalizer と同じ「URL ごとに一意」な振る舞いを最小限で再現する（不正 URL は throw）。
      normalizer: { hashUrl: (url: string) => `hash-${new URL(url).pathname.replace('/', '')}` },
      now: () => NOW,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runStartupCleanup_ツリーが空_掃除をスキップする', async () => {
    deps.bookmarks.getTree.mockResolvedValue([]);

    const summary = await runStartupCleanup(deps);

    expect(summary.isSkipped).toBe(true);
    expect(deps.localState.set).not.toHaveBeenCalled();
    expect(deps.aliases.getAll).not.toHaveBeenCalled();
    expect(deps.trash.purgeExpired).not.toHaveBeenCalled();
  });

  it('runStartupCleanup_ブックマーク0件_別名掃除をスキップする', async () => {
    // フォルダだけが同期済みでブックマークが未同期の状態を模す。
    deps.bookmarks.getTree.mockResolvedValue([
      { id: '0', title: '', children: [{ id: '1', parentId: '0', title: 'バー' }] },
    ]);
    deps.aliases.getAll.mockResolvedValue(new Map([['hash-a', aliasRecord()]]));

    const summary = await runStartupCleanup(deps);

    expect(summary.removedAliasCount).toBe(0);
    expect(deps.aliases.remove).not.toHaveBeenCalled();
  });

  it('runStartupCleanup_孤立別名_removeが呼ばれる', async () => {
    deps.aliases.getAll.mockResolvedValue(
      new Map([
        ['hash-a', aliasRecord()], // 現存（/a）
        ['hash-gone', aliasRecord({ urlHash: 'hash-gone', url: 'https://ex.com/gone' })], // 孤立・猶予超過
        ['hash-new', aliasRecord({ urlHash: 'hash-new', url: 'https://ex.com/new', updatedAt: NOW })], // 孤立だが猶予内
      ]),
    );

    const summary = await runStartupCleanup(deps);

    expect(summary.removedAliasCount).toBe(1);
    expect(deps.aliases.remove).toHaveBeenCalledTimes(1);
    expect(deps.aliases.remove).toHaveBeenCalledWith('https://ex.com/gone');
  });

  it('runStartupCleanup_不正URLのブックマーク_他の別名の孤立判定を壊さない', async () => {
    deps.bookmarks.getTree.mockResolvedValue([
      {
        id: '0',
        title: '',
        children: [
          { id: '100', parentId: '0', title: 'A', url: 'https://ex.com/a' },
          { id: '101', parentId: '0', title: 'JS', url: 'javascript:void(0)' },
        ],
      },
    ]);
    deps.aliases.getAll.mockResolvedValue(new Map([['hash-a', aliasRecord()]]));

    const summary = await runStartupCleanup(deps);

    expect(summary.removedAliasCount).toBe(0);
    expect(deps.aliases.remove).not.toHaveBeenCalled();
  });

  it('runStartupCleanup_存在しない参照あり_localStateが更新される', async () => {
    deps.localState.get.mockResolvedValue({ expandedFolderIds: ['1', '999'], lastUsedFolderId: '999' });

    const summary = await runStartupCleanup(deps);

    expect(summary.isLocalStateChanged).toBe(true);
    expect(deps.localState.set).toHaveBeenCalledWith({ expandedFolderIds: ['1'] });
  });

  it('runStartupCleanup_変更なし_localState.setが呼ばれない', async () => {
    const summary = await runStartupCleanup(deps);

    expect(summary.isLocalStateChanged).toBe(false);
    expect(deps.localState.set).not.toHaveBeenCalled();
  });

  it('runStartupCleanup_期限切れゴミ箱_purgeExpiredとenforceLimitsが呼ばれる', async () => {
    deps.settings.get.mockResolvedValue({ trashRetentionDays: 7 });
    deps.trash.purgeExpired.mockResolvedValue(3);
    deps.trash.enforceLimits.mockResolvedValue(2);

    const summary = await runStartupCleanup(deps);

    expect(deps.trash.purgeExpired).toHaveBeenCalledWith(7);
    expect(deps.trash.enforceLimits).toHaveBeenCalled();
    expect(summary.purgedTrashCount).toBe(5);
  });

  it('runStartupCleanup_別名削除が失敗_ゴミ箱掃除は実行されconsole.errorが出る', async () => {
    deps.aliases.getAll.mockRejectedValue(new Error('sync 読み取り失敗'));
    deps.trash.purgeExpired.mockResolvedValue(1);

    const summary = await runStartupCleanup(deps);

    expect(summary.removedAliasCount).toBe(0);
    expect(summary.purgedTrashCount).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('runStartupCleanup_ローカル状態の掃除が失敗_後続ステップは継続する', async () => {
    deps.localState.get.mockRejectedValue(new Error('storage 読み取り失敗'));
    deps.trash.purgeExpired.mockResolvedValue(2);

    const summary = await runStartupCleanup(deps);

    expect(summary.isLocalStateChanged).toBe(false);
    expect(summary.purgedTrashCount).toBe(2);
    expect(console.error).toHaveBeenCalled();
  });

  it('runStartupCleanup_ツリー取得が失敗_スキップして例外を投げない', async () => {
    deps.bookmarks.getTree.mockRejectedValue(new Error('bookmarks 取得失敗'));

    const summary = await runStartupCleanup(deps);

    expect(summary.isSkipped).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
});
