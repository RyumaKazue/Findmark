import { MAX_TRASH_BYTES, MAX_TRASH_ITEMS, TrashStore } from './trashStore.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrashBookmarkGateway, TrashAliasGateway } from './trashStore.js';
import type { TrashInput, TrashItem } from '../types.js';

// TrashStore は chrome.storage.local を直接呼び出す。実際の Chrome API 挙動（get/set の永続化）を
// Map バックのインメモリ実装で再現し、vi.stubGlobal で差し替える（aliasStore.test.ts と同方式）。

const createInMemoryArea = () => {
  const data = new Map<string, unknown>();

  const area = {
    get: vi.fn(async (keys: string[]) => {
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        if (data.has(key)) {
          result[key] = data.get(key);
        }
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) {
        data.set(key, value);
      }
    }),
  };

  return { area, data };
};

const bookmarkInput = (overrides: Partial<TrashInput> = {}): TrashInput => ({
  kind: 'bookmark',
  url: 'https://ex.com/a',
  title: 'タイトルA',
  folderPath: ['ブックマーク バー', 'Dev'],
  aliases: ['あ'],
  ...overrides,
});

let localMock: ReturnType<typeof createInMemoryArea>;
let bookmarks: TrashBookmarkGateway & { ensureFolderPath: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
let aliases: TrashAliasGateway & { upsert: ReturnType<typeof vi.fn> };
let store: TrashStore;
let nextId = 0;

beforeEach(() => {
  localMock = createInMemoryArea();
  vi.stubGlobal('chrome', { storage: { local: localMock.area } });

  nextId = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `trash-${nextId++}` });

  bookmarks = {
    ensureFolderPath: vi.fn(async () => 'parent-1'),
    create: vi.fn(async (data: { url?: string; title: string; parentId: string }) => ({
      id: `created-${data.title}`,
      parentId: data.parentId,
      title: data.title,
      url: data.url,
    })),
  };
  aliases = { upsert: vi.fn(async () => undefined) };

  store = new TrashStore(bookmarks, aliases);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TrashStore.push / list', () => {
  it('push_id_deletedAtを採番して保存する', async () => {
    vi.setSystemTime(new Date('2026-08-14T00:00:00Z'));
    const id = await store.push(bookmarkInput());

    expect(id).toBe('trash-0');
    const items = await store.list();
    expect(items).toEqual([
      expect.objectContaining({
        id: 'trash-0',
        kind: 'bookmark',
        url: 'https://ex.com/a',
        title: 'タイトルA',
        folderPath: ['ブックマーク バー', 'Dev'],
        aliases: ['あ'],
        deletedAt: new Date('2026-08-14T00:00:00Z').getTime(),
      }),
    ]);
    vi.useRealTimers();
  });

  it('list_複数件_deletedAt降順で返す', async () => {
    vi.setSystemTime(new Date('2026-08-10T00:00:00Z'));
    await store.push(bookmarkInput({ title: '古い' }));
    vi.setSystemTime(new Date('2026-08-12T00:00:00Z'));
    await store.push(bookmarkInput({ title: '新しい' }));

    const items = await store.list();
    expect(items.map(i => i.title)).toEqual(['新しい', '古い']);
    vi.useRealTimers();
  });
});

describe('TrashStore.restore(bookmark)', () => {
  it('restore_成功_ensureFolderPath_create_upsertを呼びゴミ箱から消える', async () => {
    const id = await store.push(bookmarkInput());

    await store.restore(id);

    expect(bookmarks.ensureFolderPath).toHaveBeenCalledWith(['ブックマーク バー', 'Dev']);
    expect(bookmarks.create).toHaveBeenCalledWith({
      url: 'https://ex.com/a',
      title: 'タイトルA',
      parentId: 'parent-1',
    });
    expect(aliases.upsert).toHaveBeenCalledWith('https://ex.com/a', ['あ']);
    expect(await store.list()).toEqual([]);
  });

  it('restore_別名なし_upsertを呼ばない', async () => {
    const id = await store.push(bookmarkInput({ aliases: [] }));

    await store.restore(id);

    expect(aliases.upsert).not.toHaveBeenCalled();
  });

  it('restore_存在しないid_エラーをスローする', async () => {
    await expect(store.restore('missing')).rejects.toThrow('ゴミ箱に存在しません');
  });

  it('restore_ensureFolderPathが失敗_項目がゴミ箱に残る', async () => {
    bookmarks.ensureFolderPath.mockRejectedValueOnce(new Error('boom'));
    const id = await store.push(bookmarkInput());

    await expect(store.restore(id)).rejects.toThrow('boom');
    expect(await store.list()).toHaveLength(1);
  });
});

describe('TrashStore.restore(folder)', () => {
  it('restore_folder_配下ツリーを再帰的に復元する', async () => {
    const folderInput: TrashInput = {
      kind: 'folder',
      title: 'サブフォルダ',
      folderPath: ['ブックマーク バー'],
      aliases: [],
      children: [
        {
          kind: 'bookmark',
          url: 'https://ex.com/child',
          title: '子ブックマーク',
          folderPath: [],
          aliases: ['子の別名'],
        },
        { kind: 'folder', title: '孫フォルダ', folderPath: [], aliases: [], children: [] },
      ],
    };
    const id = await store.push(folderInput);

    await store.restore(id);

    expect(bookmarks.create).toHaveBeenCalledWith({ title: 'サブフォルダ', parentId: 'parent-1' });
    const folderCreatedId = 'created-サブフォルダ';
    expect(bookmarks.create).toHaveBeenCalledWith({
      url: 'https://ex.com/child',
      title: '子ブックマーク',
      parentId: folderCreatedId,
    });
    expect(bookmarks.create).toHaveBeenCalledWith({ title: '孫フォルダ', parentId: folderCreatedId });
    expect(aliases.upsert).toHaveBeenCalledWith('https://ex.com/child', ['子の別名']);
    expect(await store.list()).toEqual([]);
  });
});

describe('TrashStore.purgeExpired', () => {
  it('purgeExpired_境界_ちょうど30日は残り31日は削除される', async () => {
    const now = new Date('2026-08-14T00:00:00Z').getTime();
    vi.setSystemTime(now);

    // deletedAt を直接ストレージへ仕込み、境界値を厳密に制御する。
    const dayMs = 24 * 60 * 60 * 1000;
    const items: TrashItem[] = [
      {
        id: 'exact-30',
        kind: 'bookmark',
        url: 'https://ex.com/1',
        title: '30日ちょうど',
        folderPath: [],
        aliases: [],
        deletedAt: now - 30 * dayMs,
      },
      {
        id: 'over-31',
        kind: 'bookmark',
        url: 'https://ex.com/2',
        title: '31日経過',
        folderPath: [],
        aliases: [],
        deletedAt: now - 31 * dayMs,
      },
    ];
    localMock.data.set('trash', items);

    const removedCount = await store.purgeExpired(30);

    expect(removedCount).toBe(1);
    const remaining = await store.list();
    expect(remaining.map(i => i.id)).toEqual(['exact-30']);
    vi.useRealTimers();
  });
});

describe('TrashStore.enforceLimits', () => {
  it('enforceLimits_件数上限超過_古い順に削除する', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const items: TrashItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: 'bookmark' as const,
      url: `https://ex.com/${i}`,
      title: `item-${i}`,
      folderPath: [],
      aliases: [],
      deletedAt: now - (5 - i) * dayMs, // id-0 が最も古い
    }));
    localMock.data.set('trash', items);

    const removedCount = await store.enforceLimits(3, MAX_TRASH_BYTES);

    expect(removedCount).toBe(2);
    const remaining = await store.list();
    expect(remaining.map(i => i.id).sort()).toEqual(['id-2', 'id-3', 'id-4']);
  });

  it('enforceLimits_容量上限超過_古い順に削除する', async () => {
    const now = Date.now();
    const items: TrashItem[] = Array.from({ length: 3 }, (_, i) => ({
      id: `id-${i}`,
      kind: 'bookmark' as const,
      url: `https://ex.com/${i}`,
      title: 'x'.repeat(1000),
      folderPath: [],
      aliases: [],
      deletedAt: now - (3 - i) * 1000,
    }));
    localMock.data.set('trash', items);
    const currentBytes = new TextEncoder().encode(JSON.stringify(items)).length;

    const removedCount = await store.enforceLimits(MAX_TRASH_ITEMS, currentBytes - 1);

    expect(removedCount).toBeGreaterThan(0);
    const remaining = await store.list();
    expect(remaining.some(i => i.id === 'id-0')).toBe(false);
  });

  it('push_上限超過_内部でenforceLimitsが適用される', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const items: TrashItem[] = Array.from({ length: MAX_TRASH_ITEMS }, (_, i) => ({
      id: `id-${i}`,
      kind: 'bookmark' as const,
      url: `https://ex.com/${i}`,
      title: `item-${i}`,
      folderPath: [],
      aliases: [],
      deletedAt: now - (MAX_TRASH_ITEMS - i) * dayMs,
    }));
    localMock.data.set('trash', items);

    await store.push(bookmarkInput({ title: '新規追加' }));

    const remaining = await store.list();
    expect(remaining).toHaveLength(MAX_TRASH_ITEMS);
    expect(remaining.some(i => i.id === 'id-0')).toBe(false); // 最古が落ちる
    expect(remaining.some(i => i.title === '新規追加')).toBe(true);
  });
});

describe('TrashStore.push 並行呼び出し', () => {
  it('push_Promise_allで並行実行_全件が取りこぼしなく保存される', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.push(bookmarkInput({ title: `並行${i}` }))));

    const items = await store.list();
    expect(items).toHaveLength(10);
  });
});

describe('TrashStore.remove / clear', () => {
  it('remove_指定id_その項目のみ削除する', async () => {
    const id1 = await store.push(bookmarkInput({ title: 'A' }));
    const id2 = await store.push(bookmarkInput({ title: 'B' }));

    await store.remove(id1);

    const items = await store.list();
    expect(items.map(i => i.id)).toEqual([id2]);
  });

  it('clear_全件削除する', async () => {
    await store.push(bookmarkInput({ title: 'A' }));
    await store.push(bookmarkInput({ title: 'B' }));

    await store.clear();

    expect(await store.list()).toEqual([]);
  });
});
