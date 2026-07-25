import { BookmarkService } from './bookmarkService.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// chrome API をモックして BookmarkService の振る舞いを検証する。
// BookmarkService は globalThis.chrome を呼び出し時に参照するため、vi.stubGlobal で差し替えられる。
const createChromeMock = () => ({
  bookmarks: {
    getTree: vi.fn(),
    get: vi.fn(),
    getChildren: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
  },
  tabs: {
    query: vi.fn(),
    update: vi.fn(),
  },
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://test-ext-id${path}`),
    id: 'test-ext-id',
  },
});

let chromeMock: ReturnType<typeof createChromeMock>;
let service: BookmarkService;

beforeEach(() => {
  chromeMock = createChromeMock();
  vi.stubGlobal('chrome', chromeMock);
  service = new BookmarkService();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BookmarkService.getTree', () => {
  it('chrome の BookmarkTreeNode をドメイン BookmarkNode へ写像し、children を再帰変換する', async () => {
    chromeMock.bookmarks.getTree.mockResolvedValue([
      {
        id: '0',
        title: '',
        index: 0, // 写像で除去されるべき余分なフィールド
        children: [
          { id: '1', parentId: '0', title: 'ブックマークバー', index: 0, dateAdded: 100 },
          { id: '2', parentId: '0', title: 'GitHub', url: 'https://github.com', index: 1 },
        ],
      },
    ]);

    const tree = await service.getTree();

    expect(tree).toEqual([
      {
        id: '0',
        parentId: undefined,
        title: '',
        url: undefined,
        dateAdded: undefined,
        children: [
          { id: '1', parentId: '0', title: 'ブックマークバー', url: undefined, dateAdded: 100, children: undefined },
          {
            id: '2',
            parentId: '0',
            title: 'GitHub',
            url: 'https://github.com',
            dateAdded: undefined,
            children: undefined,
          },
        ],
      },
    ]);
    // 余分な chrome フィールド(index)は写像されない
    expect(tree[0]).not.toHaveProperty('index');
  });
});

describe('BookmarkService.getFolderPath', () => {
  // 実 chrome 構造: root '0'(親なし) > 'ブックマークバー'(1) > '開発'(2) > 'GitHub'(gh, ブックマーク)
  const nodes: Record<string, { id: string; parentId?: string; title: string; url?: string }> = {
    '0': { id: '0', title: '' },
    '1': { id: '1', parentId: '0', title: 'ブックマークバー' },
    '2': { id: '2', parentId: '1', title: '開発' },
    gh: { id: 'gh', parentId: '2', title: 'GitHub', url: 'https://github.com' },
  };

  beforeEach(() => {
    chromeMock.bookmarks.get.mockImplementation((id: string) => Promise.resolve([nodes[id]]));
  });

  it('ブックマーク自身のタイトルは含めず、格納フォルダ階層(トップレベル含む)を返す', async () => {
    const path = await service.getFolderPath('gh');

    // 'GitHub'(自身)は含めない。'ブックマークバー'(トップレベル)は含める。真のルート '0' は含めない。
    expect(path).toEqual(['ブックマークバー', '開発']);
    expect(path).not.toContain('GitHub');
  });

  it('フォルダを渡した場合もそのフォルダ自身は含めず、親フォルダ階層を返す', async () => {
    const path = await service.getFolderPath('2'); // '開発'
    expect(path).toEqual(['ブックマークバー']);
  });
});

describe('BookmarkService.ensureFolderPath', () => {
  beforeEach(() => {
    // ルート '0' の最初の子 = 'ブックマークバー'(id '1')。
    chromeMock.bookmarks.getTree.mockResolvedValue([
      { id: '0', title: '', children: [{ id: '1', title: 'ブックマークバー' }] },
    ]);
  });

  it('既存トップレベルフォルダは再利用し、欠落した階層のみ作成して末端 ID を返す', async () => {
    chromeMock.bookmarks.getChildren.mockImplementation((parentId: string) => {
      if (parentId === '0') {
        return Promise.resolve([{ id: '1', title: 'ブックマークバー', url: undefined }]); // 既存
      }
      return Promise.resolve([]); // 'ブックマークバー' 配下に '記事' は無い
    });
    chromeMock.bookmarks.create.mockResolvedValue({ id: 'new', title: '記事' });

    // getFolderPath と同じ意味論: トップレベル('ブックマークバー')を含むパスを渡す。
    const endId = await service.ensureFolderPath(['ブックマークバー', '記事']);

    expect(endId).toBe('new');
    // 'ブックマークバー' は既存のため作成されない。'記事' のみ作成される。
    expect(chromeMock.bookmarks.create).toHaveBeenCalledTimes(1);
    expect(chromeMock.bookmarks.create).toHaveBeenCalledWith({ parentId: '1', title: '記事' });
  });

  it('空配列なら既定の書き込み先(ブックマークバー)の ID を返し、何も作成しない', async () => {
    const endId = await service.ensureFolderPath([]);

    expect(endId).toBe('1');
    expect(chromeMock.bookmarks.create).not.toHaveBeenCalled();
  });
});

describe('BookmarkService 編集系', () => {
  it('create は create を呼び、結果をドメイン型で返す', async () => {
    chromeMock.bookmarks.create.mockResolvedValue({
      id: '9',
      parentId: '1',
      title: 'X',
      url: 'https://x.com',
      index: 0,
    });

    const node = await service.create({ url: 'https://x.com', title: 'X', parentId: '1' });

    expect(chromeMock.bookmarks.create).toHaveBeenCalledWith({ url: 'https://x.com', title: 'X', parentId: '1' });
    expect(node).toEqual({
      id: '9',
      parentId: '1',
      title: 'X',
      url: 'https://x.com',
      dateAdded: undefined,
      children: undefined,
    });
  });

  it('rename は update(id, { title }) を呼ぶ', async () => {
    await service.rename('9', '新タイトル');
    expect(chromeMock.bookmarks.update).toHaveBeenCalledWith('9', { title: '新タイトル' });
  });

  it('updateUrl は update(id, { url }) を呼ぶ', async () => {
    await service.updateUrl('9', 'https://new.com');
    expect(chromeMock.bookmarks.update).toHaveBeenCalledWith('9', { url: 'https://new.com' });
  });

  it('move は move(id, { parentId }) を呼ぶ', async () => {
    await service.move('9', '2');
    expect(chromeMock.bookmarks.move).toHaveBeenCalledWith('9', { parentId: '2' });
  });

  it('remove は remove(id) を呼ぶ', async () => {
    await service.remove('9');
    expect(chromeMock.bookmarks.remove).toHaveBeenCalledWith('9');
  });
});

describe('BookmarkService.getCurrentTab', () => {
  it('アクティブタブの url/title を返す', async () => {
    chromeMock.tabs.query.mockResolvedValue([{ url: 'https://ex.com', title: 'Example' }]);

    const tab = await service.getCurrentTab();

    expect(chromeMock.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(tab).toEqual({ url: 'https://ex.com', title: 'Example' });
  });

  it('url/title が取れない(chrome:// 等)場合は空文字にフォールバックする', async () => {
    chromeMock.tabs.query.mockResolvedValue([{}]);
    expect(await service.getCurrentTab()).toEqual({ url: '', title: '' });
  });

  it('アクティブタブが無い場合も空文字にフォールバックする', async () => {
    chromeMock.tabs.query.mockResolvedValue([]);
    expect(await service.getCurrentTab()).toEqual({ url: '', title: '' });
  });
});

describe('BookmarkService.openUrl', () => {
  it('アクティブタブで URL を開く（tabs.update({ url }) を呼ぶ）', async () => {
    chromeMock.tabs.update.mockResolvedValue({});
    await service.openUrl('https://ex.com/a');
    expect(chromeMock.tabs.update).toHaveBeenCalledWith({ url: 'https://ex.com/a' });
  });
});

describe('BookmarkService.faviconUrl', () => {
  it('runtime オリジンの _favicon URL に pageUrl と size を付与する', () => {
    const url = service.faviconUrl('https://ex.com/a', 32);

    // chrome-extension は非 special スキームのため URL.origin は 'null'（opaque）になる。
    // href の前方一致とクエリパラメータで検証する。
    expect(url).toContain('chrome-extension://test-ext-id/_favicon/');
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('chrome-extension:');
    expect(parsed.searchParams.get('pageUrl')).toBe('https://ex.com/a');
    expect(parsed.searchParams.get('size')).toBe('32');
  });

  it('size 省略時は既定 16 を使う', () => {
    const parsed = new URL(service.faviconUrl('https://ex.com/a'));
    expect(parsed.searchParams.get('size')).toBe('16');
  });
});
