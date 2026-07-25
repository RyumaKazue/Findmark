import { AliasLimitError, AliasStore } from './aliasStore.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AliasNormalizer } from './aliasStore.js';

// AliasStore は chrome.storage.sync/local を直接呼び出す。実際の Chrome API 挙動（get/set/remove の
// 永続化とエラー）を Map バックのインメモリ実装で再現し、vi.stubGlobal で差し替える。

const createInMemoryArea = () => {
  const data = new Map<string, unknown>();
  let failNextSet = false;

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
      if (failNextSet) {
        failNextSet = false;
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      for (const [key, value] of Object.entries(items)) {
        data.set(key, value);
      }
    }),
    remove: vi.fn(async (keys: string[]) => {
      for (const key of keys) {
        data.delete(key);
      }
    }),
  };

  return {
    area,
    data,
    failNextSet: () => {
      failNextSet = true;
    },
  };
};

// テスト用の軽量 Normalizer スタブ。shared パッケージには依存しない
// （packages/storage は packages/shared に依存できないため、テストでも実体を import しない）。
const stubNormalizer: AliasNormalizer = {
  hashUrl: (url: string) => {
    const u = new URL(url);
    u.hash = '';
    if (u.pathname.endsWith('/') && u.pathname !== '/') {
      u.pathname = u.pathname.slice(0, -1);
    }
    const normalized = u.protocol + '//' + u.host + u.pathname + u.search;
    let h = 0x811c9dc5;
    for (let i = 0; i < normalized.length; i++) {
      h ^= normalized.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  },
  normalizeText: (input: string) => input.normalize('NFKC').toLowerCase(),
};

let syncMock: ReturnType<typeof createInMemoryArea>;
let localMock: ReturnType<typeof createInMemoryArea>;
let store: AliasStore;

beforeEach(() => {
  syncMock = createInMemoryArea();
  localMock = createInMemoryArea();
  vi.stubGlobal('chrome', {
    storage: {
      sync: syncMock.area,
      local: localMock.area,
    },
  });
  store = new AliasStore(stubNormalizer);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AliasStore.upsert / getByUrl', () => {
  it('upsert_同一URLで再登録_getByUrlが最新別名を返す', async () => {
    await store.upsert('https://ex.com/a', ['first']);
    await store.upsert('https://ex.com/a', ['second', 'third']);

    const record = await store.getByUrl('https://ex.com/a');
    expect(record?.aliases).toEqual(['second', 'third']);
  });

  it('upsert_正規化後に重複する別名_重複が排除される', async () => {
    await store.upsert('https://ex.com/a', ['Docs', 'ＤＯＣＳ', 'docs', 'guide']);

    const record = await store.getByUrl('https://ex.com/a');
    expect(record?.aliases).toEqual(['Docs', 'guide']);
  });

  it('upsert_21個目の別名_AliasLimitErrorをスローする', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `a${i}`);
    await expect(store.upsert('https://ex.com/a', [...twenty, 'over'])).rejects.toThrow(AliasLimitError);
  });

  it('upsert_21個目の別名_AliasLimitErrorのkindがcountでlimitが20', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `a${i}`);
    await expect(store.upsert('https://ex.com/a', [...twenty, 'over'])).rejects.toMatchObject({
      kind: 'count',
      limit: 20,
    });
  });

  it('upsert_51文字の別名_AliasLimitErrorをスローする', async () => {
    const tooLong = 'a'.repeat(51);
    await expect(store.upsert('https://ex.com/a', [tooLong])).rejects.toThrow(AliasLimitError);
  });

  it('upsert_51文字の別名_AliasLimitErrorのkindがlengthでlimitが50', async () => {
    const tooLong = 'a'.repeat(51);
    await expect(store.upsert('https://ex.com/a', [tooLong])).rejects.toMatchObject({
      kind: 'length',
      limit: 50,
    });
  });

  it('getByUrl_未登録URL_nullを返す', async () => {
    expect(await store.getByUrl('https://unknown.test')).toBeNull();
  });

  it('getByUrl_表記ゆれURL_同一レコードに解決される', async () => {
    await store.upsert('https://ex.com/a/b/', ['alias1']);

    const record = await store.getByUrl('https://ex.com/a/b#fragment');
    expect(record?.aliases).toEqual(['alias1']);
  });
});

describe('AliasStore.getAll', () => {
  it('getAll_複数レコード_全レコードを結合して返す', async () => {
    await store.upsert('https://ex.com/a', ['alias-a']);
    await store.upsert('https://ex.com/b', ['alias-b']);

    const all = await store.getAll();
    expect(all.size).toBe(2);
    expect(all.get(stubNormalizer.hashUrl('https://ex.com/a'))?.aliases).toEqual(['alias-a']);
    expect(all.get(stubNormalizer.hashUrl('https://ex.com/b'))?.aliases).toEqual(['alias-b']);
  });

  it('getAll_多数レコード投入_バイト長閾値超過で新チャンクに分割される', async () => {
    // 1レコードあたり概算 100バイト超。7KB(7168バイト)閾値を超えるには 70件超が必要。
    for (let i = 0; i < 90; i++) {
      await store.upsert(`https://ex.com/page-${i}`, [`alias-${i}-abcdefghijklmnop`]);
    }

    const index = syncMock.data.get('alias_index') as { chunkCount: number };
    expect(index.chunkCount).toBeGreaterThan(1);

    const all = await store.getAll();
    expect(all.size).toBe(90);
  });
});

describe('AliasStore.merge', () => {
  it('merge_既存と入力_和集合がマージされ重複排除される', async () => {
    await store.upsert('https://ex.com/a', ['existing1', 'existing2']);

    const merged = await store.merge('https://ex.com/a', ['existing1', 'new1']);

    expect(merged.aliases).toEqual(['existing1', 'existing2', 'new1']);
  });

  it('merge_未登録URL_incomingのみで新規作成される', async () => {
    const merged = await store.merge('https://ex.com/new', ['alias1']);
    expect(merged.aliases).toEqual(['alias1']);
  });
});

describe('AliasStore.remove', () => {
  it('remove_既存レコード_getByUrlがnullを返す', async () => {
    await store.upsert('https://ex.com/a', ['alias1']);
    await store.remove('https://ex.com/a');

    expect(await store.getByUrl('https://ex.com/a')).toBeNull();
  });

  it('remove_既存レコード_getAllに含まれなくなる', async () => {
    await store.upsert('https://ex.com/a', ['alias1']);
    await store.upsert('https://ex.com/b', ['alias2']);
    await store.remove('https://ex.com/a');

    const all = await store.getAll();
    expect(all.has(stubNormalizer.hashUrl('https://ex.com/a'))).toBe(false);
    expect(all.has(stubNormalizer.hashUrl('https://ex.com/b'))).toBe(true);
  });

  it('remove_未登録URL_エラーにならない', async () => {
    await expect(store.remove('https://never-existed.test')).resolves.toBeUndefined();
  });
});

describe('AliasStore sync→localフォールバック', () => {
  it('upsert_syncがQUOTAで失敗_localへ退避しstorageModeがlocalになる', async () => {
    await store.upsert('https://ex.com/a', ['alias1']);

    syncMock.failNextSet();
    await store.upsert('https://ex.com/b', ['alias2']);

    const localIndex = localMock.data.get('alias_index') as { storageMode: string };
    expect(localIndex.storageMode).toBe('local');
  });

  it('upsert_syncがQUOTAで失敗_フォールバック後もデータが失われない', async () => {
    await store.upsert('https://ex.com/a', ['alias1']);

    syncMock.failNextSet();
    await store.upsert('https://ex.com/b', ['alias2']);

    const recordA = await store.getByUrl('https://ex.com/a');
    const recordB = await store.getByUrl('https://ex.com/b');
    expect(recordA?.aliases).toEqual(['alias1']);
    expect(recordB?.aliases).toEqual(['alias2']);
  });

  it('フォールバック後_syncのキーが削除されている', async () => {
    await store.upsert('https://ex.com/a', ['alias1']);

    syncMock.failNextSet();
    await store.upsert('https://ex.com/b', ['alias2']);

    expect(syncMock.data.has('alias_index')).toBe(false);
    expect(syncMock.data.has('alias_chunk_0')).toBe(false);
  });

  it('フォールバック後_さらなるupsertがlocalに対して動作する', async () => {
    await store.upsert('https://ex.com/a', ['alias1']);
    syncMock.failNextSet();
    await store.upsert('https://ex.com/b', ['alias2']);

    await store.upsert('https://ex.com/c', ['alias3']);

    const recordC = await store.getByUrl('https://ex.com/c');
    expect(recordC?.aliases).toEqual(['alias3']);
    expect(syncMock.data.has('alias_index')).toBe(false);
  });

  it('upsert_syncが非QUOTAエラーで失敗_localへフォールバックせず再throwしconsole.errorに記録する', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    syncMock.area.set.mockImplementationOnce(async () => {
      throw new Error('unexpected storage failure');
    });

    await expect(store.upsert('https://ex.com/a', ['alias1'])).rejects.toThrow('unexpected storage failure');
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('AliasStore'), expect.any(Error));
    expect(localMock.data.has('alias_index')).toBe(false);

    consoleErrorSpy.mockRestore();
  });
});

describe('AliasStore 並行書き込みの直列化', () => {
  // upsert/remove は「チャンクを読む→メモリ上で変更→書き戻す」非アトミックな read-modify-write を行う。
  // 直列化がなければ、並行呼び出しで後勝ちの set が先の変更を丸ごと上書きし、データが消失する。
  it('upsert_異なるURLを並行実行_両方のレコードが失われず保存される', async () => {
    await Promise.all([store.upsert('https://a.example', ['alias-a']), store.upsert('https://b.example', ['alias-b'])]);

    const all = await store.getAll();
    expect(all.size).toBe(2);
    expect((await store.getByUrl('https://a.example'))?.aliases).toEqual(['alias-a']);
    expect((await store.getByUrl('https://b.example'))?.aliases).toEqual(['alias-b']);
  });

  it('upsert_多数URLを並行実行_全件が失われず保存される', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://parallel.example/${i}`);
    await Promise.all(urls.map(url => store.upsert(url, [`alias-${url}`])));

    const all = await store.getAll();
    expect(all.size).toBe(20);
  });

  it('remove_upsertと並行実行_互いのデータを破壊しない', async () => {
    await store.upsert('https://a.example', ['alias-a']);

    await Promise.all([store.upsert('https://b.example', ['alias-b']), store.remove('https://a.example')]);

    expect(await store.getByUrl('https://a.example')).toBeNull();
    expect((await store.getByUrl('https://b.example'))?.aliases).toEqual(['alias-b']);
  });

  it('merge_並行実行_双方のレコードが失われず保存される', async () => {
    await Promise.all([store.merge('https://a.example', ['alias-a']), store.merge('https://b.example', ['alias-b'])]);

    const all = await store.getAll();
    expect(all.size).toBe(2);
  });
});
