import { ImportExportService } from './ImportExportService.js';
import { parseJsonFile, serializeJsonFile } from './jsonFormat.js';
import { describe, expect, it, vi } from 'vitest';
import type { AliasOps, BookmarkOps, ConflictResolver } from './ImportExportService.js';
import type { ImportBookmark } from './jsonFormat.js';
import type { AliasRecord, BookmarkNode } from '@extension/storage';

/** テスト用の恒等正規化（URL をそのままキーとして使う。ハッシュ化の中身はここでは無関係）。 */
const testNormalizer = { hashUrl: (url: string) => url };

interface StoredNode {
  id: string;
  title: string;
  url?: string;
  parentId?: string;
  folderPath: string[];
}

/**
 * `BookmarkOps` の最小モック実装。フォルダは `path.join('/')` をキーに ID を採番し、
 * `ensureFolderPath` は同じパスに対して同じ ID を返す（既存 `BookmarkService.ensureFolderPath` と同じ意味論）。
 */
class MockBookmarkOps implements BookmarkOps {
  nodes = new Map<string, StoredNode>();
  private folderIds = new Map<string, string>();
  private nextId = 1;

  async getTree(): Promise<BookmarkNode[]> {
    // exportJson/exportHtml のテストでのみ使用。フラットな nodes から簡易的な木を組み立てる。
    const root: BookmarkNode = { id: 'root', title: '', children: [] };
    const folderNodes = new Map<string, BookmarkNode>();
    const getFolder = (path: string[]): BookmarkNode => {
      if (path.length === 0) {
        return root;
      }
      const key = path.join('/');
      let node = folderNodes.get(key);
      if (!node) {
        const parent = getFolder(path.slice(0, -1));
        node = { id: `folder:${key}`, parentId: parent.id, title: path[path.length - 1], children: [] };
        parent.children!.push(node);
        folderNodes.set(key, node);
      }
      return node;
    };
    for (const n of this.nodes.values()) {
      const parent = getFolder(n.folderPath);
      parent.children!.push({ id: n.id, parentId: parent.id, title: n.title, url: n.url });
    }
    return [root];
  }

  async findByUrl(url: string): Promise<BookmarkNode | null> {
    for (const n of this.nodes.values()) {
      if (n.url === url) {
        return { id: n.id, title: n.title, url: n.url, parentId: n.parentId };
      }
    }
    return null;
  }

  async getFolderPath(id: string): Promise<string[]> {
    return this.nodes.get(id)?.folderPath ?? [];
  }

  async ensureFolderPath(path: string[]): Promise<string> {
    const key = path.join('/');
    let id = this.folderIds.get(key);
    if (!id) {
      id = `folder-${this.nextId++}`;
      this.folderIds.set(key, id);
    }
    return id;
  }

  private folderPathOf(parentId: string): string[] {
    for (const [key, id] of this.folderIds) {
      if (id === parentId) {
        return key === '' ? [] : key.split('/');
      }
    }
    return [];
  }

  async create(data: { url?: string; title: string; parentId: string }): Promise<BookmarkNode> {
    const id = `node-${this.nextId++}`;
    const node: StoredNode = {
      id,
      title: data.title,
      url: data.url,
      parentId: data.parentId,
      folderPath: this.folderPathOf(data.parentId),
    };
    this.nodes.set(id, node);
    return { id, title: data.title, url: data.url, parentId: data.parentId };
  }

  async rename(id: string, title: string): Promise<void> {
    const n = this.nodes.get(id);
    if (n) {
      n.title = title;
    }
  }

  async move(id: string, parentId: string): Promise<void> {
    const n = this.nodes.get(id);
    if (n) {
      n.parentId = parentId;
      n.folderPath = this.folderPathOf(parentId);
    }
  }
}

/** `AliasOps` の最小モック実装。URL をそのままキーにする（`testNormalizer` と対応）。 */
class MockAliasOps implements AliasOps {
  records = new Map<string, string[]>();

  async getAll(): Promise<Map<string, AliasRecord>> {
    const map = new Map<string, AliasRecord>();
    for (const [url, aliases] of this.records) {
      map.set(url, { urlHash: url, url, aliases, updatedAt: 0 });
    }
    return map;
  }

  async upsert(url: string, aliases: string[]): Promise<void> {
    this.records.set(url, aliases);
  }

  async merge(url: string, incoming: string[]): Promise<AliasRecord> {
    const existing = this.records.get(url) ?? [];
    const merged = [...new Set([...existing, ...incoming])];
    this.records.set(url, merged);
    return { urlHash: url, url, aliases: merged, updatedAt: 0 };
  }
}

const jsonFile = (bookmarks: Omit<ImportBookmark, 'addedAt'>[]): string =>
  JSON.stringify({ format: 'my-bookmark-search', version: 1, bookmarks });

/** 常に同じ解決を返す resolver（呼び出し回数を検証するため `vi.fn` でラップして使う）。 */
const fixedResolver = (resolution: 'skip' | 'overwrite' | 'keepBoth', applyToAll = false): ConflictResolver => ({
  resolve: vi.fn().mockResolvedValue({ resolution, applyToAll }),
});

describe('ImportExportService.importJson — 新規（同一URLなし）', () => {
  it('新規作成し、別名を登録する', async () => {
    const bookmarkOps = new MockBookmarkOps();
    const aliasOps = new MockAliasOps();
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const report = await service.importJson(
      jsonFile([{ url: 'https://a.example.com', title: 'A', folderPath: ['開発'], aliases: ['えー'] }]),
      fixedResolver('skip'),
    );

    expect(report.created).toBe(1);
    expect(report.total).toBe(1);
    expect(aliasOps.records.get('https://a.example.com')).toEqual(['えー']);
  });

  it('別名が無ければ AliasOps を呼ばない', async () => {
    const bookmarkOps = new MockBookmarkOps();
    const aliasOps = new MockAliasOps();
    const upsertSpy = vi.spyOn(aliasOps, 'upsert');
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    await service.importJson(
      jsonFile([{ url: 'https://a.example.com', title: 'A', folderPath: [], aliases: [] }]),
      fixedResolver('skip'),
    );

    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

describe('ImportExportService.importJson — 別名のみ差分', () => {
  it('タイトル/フォルダが一致し別名だけ差分ならマージする', async () => {
    const bookmarkOps = new MockBookmarkOps();
    await bookmarkOps.create({
      url: 'https://a.example.com',
      title: 'A',
      parentId: await bookmarkOps.ensureFolderPath(['開発']),
    });
    const aliasOps = new MockAliasOps();
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const report = await service.importJson(
      jsonFile([{ url: 'https://a.example.com', title: 'A', folderPath: ['開発'], aliases: ['あたらしい'] }]),
      fixedResolver('skip'),
    );

    expect(report.aliasMerged).toBe(1);
    expect(report.created).toBe(0);
    expect(aliasOps.records.get('https://a.example.com')).toEqual(['あたらしい']);
  });

  it('完全一致（別名も無し）は skipped として扱う', async () => {
    const bookmarkOps = new MockBookmarkOps();
    await bookmarkOps.create({
      url: 'https://a.example.com',
      title: 'A',
      parentId: await bookmarkOps.ensureFolderPath(['開発']),
    });
    const aliasOps = new MockAliasOps();
    const resolver = fixedResolver('overwrite'); // 呼ばれないことを確認するため、他の値にしておく
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const report = await service.importJson(
      jsonFile([{ url: 'https://a.example.com', title: 'A', folderPath: ['開発'], aliases: [] }]),
      resolver,
    );

    expect(report.skipped).toBe(1);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});

describe('ImportExportService.importJson — タイトル/フォルダ相違（真の競合）', () => {
  const setupConflict = async () => {
    const bookmarkOps = new MockBookmarkOps();
    const parentId = await bookmarkOps.ensureFolderPath(['開発']);
    await bookmarkOps.create({ url: 'https://a.example.com', title: '旧タイトル', parentId });
    return bookmarkOps;
  };

  it('skip: 何も変更せず skipped++', async () => {
    const bookmarkOps = await setupConflict();
    const aliasOps = new MockAliasOps();
    const resolver = fixedResolver('skip');
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const report = await service.importJson(
      jsonFile([{ url: 'https://a.example.com', title: '新タイトル', folderPath: ['開発'], aliases: [] }]),
      resolver,
    );

    expect(report.skipped).toBe(1);
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    const node = [...bookmarkOps.nodes.values()][0];
    expect(node.title).toBe('旧タイトル'); // 変更されていない
  });

  it('overwrite: タイトル/フォルダを incoming で上書きし、別名もマージする', async () => {
    const bookmarkOps = await setupConflict();
    const aliasOps = new MockAliasOps();
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const report = await service.importJson(
      jsonFile([{ url: 'https://a.example.com', title: '新タイトル', folderPath: ['新フォルダ'], aliases: ['あ'] }]),
      fixedResolver('overwrite'),
    );

    expect(report.overwritten).toBe(1);
    const node = [...bookmarkOps.nodes.values()][0];
    expect(node.title).toBe('新タイトル');
    expect(node.folderPath).toEqual(['新フォルダ']);
    expect(aliasOps.records.get('https://a.example.com')).toEqual(['あ']);
  });

  it('keepBoth: 既存は変更せず、新しいノードを追加作成する', async () => {
    const bookmarkOps = await setupConflict();
    const aliasOps = new MockAliasOps();
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const report = await service.importJson(
      jsonFile([{ url: 'https://a.example.com', title: '新タイトル', folderPath: ['新フォルダ'], aliases: [] }]),
      fixedResolver('keepBoth'),
    );

    expect(report.keptBoth).toBe(1);
    expect(bookmarkOps.nodes.size).toBe(2);
    const titles = [...bookmarkOps.nodes.values()].map(n => n.title).sort();
    expect(titles).toEqual(['旧タイトル', '新タイトル'].sort());
  });

  it('applyToAll: 2件目以降は resolver を再度呼ばない', async () => {
    const bookmarkOps = new MockBookmarkOps();
    const p1 = await bookmarkOps.ensureFolderPath(['開発']);
    await bookmarkOps.create({ url: 'https://a.example.com', title: '旧A', parentId: p1 });
    await bookmarkOps.create({ url: 'https://b.example.com', title: '旧B', parentId: p1 });
    const aliasOps = new MockAliasOps();
    const resolver = fixedResolver('skip', true); // applyToAll: true
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const report = await service.importJson(
      jsonFile([
        { url: 'https://a.example.com', title: '新A', folderPath: ['開発'], aliases: [] },
        { url: 'https://b.example.com', title: '新B', folderPath: ['開発'], aliases: [] },
      ]),
      resolver,
    );

    expect(report.skipped).toBe(2);
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });
});

describe('ImportExportService.importJson — 部分失敗（1件の失敗が全体を止めない）', () => {
  it('1件が失敗しても errors に積んで残りを継続する', async () => {
    const bookmarkOps = new MockBookmarkOps();
    const aliasOps = new MockAliasOps();
    const createSpy = vi.spyOn(bookmarkOps, 'create').mockImplementation(async data => {
      if (data.title === 'B') {
        throw new Error('boom');
      }
      return MockBookmarkOps.prototype.create.call(bookmarkOps, data);
    });
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const report = await service.importJson(
      jsonFile([
        { url: 'https://a.example.com', title: 'A', folderPath: [], aliases: [] },
        { url: 'https://b.example.com', title: 'B', folderPath: [], aliases: [] },
        { url: 'https://c.example.com', title: 'C', folderPath: [], aliases: [] },
      ]),
      fixedResolver('skip'),
    );

    expect(report.created).toBe(2); // A, C
    expect(report.errors).toEqual([{ url: 'https://b.example.com', reason: 'boom' }]);
    createSpy.mockRestore();
  });

  it('ブックマーク作成が成功した後に別名保存だけ失敗しても created の計上は取り消さない', async () => {
    const bookmarkOps = new MockBookmarkOps();
    const aliasOps = new MockAliasOps();
    vi.spyOn(aliasOps, 'upsert').mockRejectedValue(new Error('alias limit'));
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const report = await service.importJson(
      jsonFile([{ url: 'https://a.example.com', title: 'A', folderPath: [], aliases: ['あ'] }]),
      fixedResolver('skip'),
    );

    expect(report.created).toBe(1); // ブックマーク自体は作成済みなので取り消さない
    expect(report.errors).toEqual([{ url: 'https://a.example.com', reason: '別名の保存に失敗しました: alias limit' }]);
  });

  it('overwrite でタイトル/フォルダの上書きが成功した後に別名マージだけ失敗しても overwritten の計上は取り消さない', async () => {
    const bookmarkOps = new MockBookmarkOps();
    const parentId = await bookmarkOps.ensureFolderPath(['開発']);
    await bookmarkOps.create({ url: 'https://a.example.com', title: '旧', parentId });
    const aliasOps = new MockAliasOps();
    vi.spyOn(aliasOps, 'merge').mockRejectedValue(new Error('alias limit'));
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const report = await service.importJson(
      jsonFile([{ url: 'https://a.example.com', title: '新', folderPath: ['開発'], aliases: ['あ'] }]),
      fixedResolver('overwrite'),
    );

    expect(report.overwritten).toBe(1); // タイトル/フォルダの上書きは成功済みなので取り消さない
    const node = [...bookmarkOps.nodes.values()][0];
    expect(node.title).toBe('新'); // 実際に上書きされている
    expect(report.errors).toEqual([{ url: 'https://a.example.com', reason: '別名の保存に失敗しました: alias limit' }]);
  });
});

describe('ImportExportService.importJson — パース失敗は中断・部分適用しない', () => {
  it('format 不正なら importJson 自体が throw する（ImportReport を返さない）', async () => {
    const service = new ImportExportService(testNormalizer, new MockBookmarkOps(), new MockAliasOps());
    await expect(service.importJson('not json', fixedResolver('skip'))).rejects.toThrow();
  });
});

describe('ImportExportService.importHtml — 新規作成のみ（重複解決なし）', () => {
  it('既存URLと同じでも重複チェックせず常に新規作成する', async () => {
    const bookmarkOps = new MockBookmarkOps();
    await bookmarkOps.create({
      url: 'https://a.example.com',
      title: '既存',
      parentId: await bookmarkOps.ensureFolderPath([]),
    });
    const aliasOps = new MockAliasOps();
    const findByUrlSpy = vi.spyOn(bookmarkOps, 'findByUrl');
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const html = `<DL><p><DT><A HREF="https://a.example.com">別名義</A></DL><p>`;
    const report = await service.importHtml(html);

    expect(report.created).toBe(1);
    expect(bookmarkOps.nodes.size).toBe(2); // 既存 + 新規（重複チェックしない）
    expect(findByUrlSpy).not.toHaveBeenCalled();
  });

  it('1件の失敗が他の件を止めない', async () => {
    const bookmarkOps = new MockBookmarkOps();
    const aliasOps = new MockAliasOps();
    vi.spyOn(bookmarkOps, 'create').mockImplementation(async data => {
      if (data.title === 'Bad') {
        throw new Error('fail');
      }
      return MockBookmarkOps.prototype.create.call(bookmarkOps, data);
    });
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const html = `<DL><p><DT><A HREF="https://a.example.com">Good</A><DT><A HREF="https://b.example.com">Bad</A></DL><p>`;
    const report = await service.importHtml(html);

    expect(report.created).toBe(1);
    expect(report.errors).toEqual([{ url: 'https://b.example.com', reason: 'fail' }]);
  });
});

describe('ImportExportService.exportJson / exportHtml', () => {
  it('exportJson は BookmarkOps.getTree() と AliasOps.getAll() を突合して出力する', async () => {
    const bookmarkOps = new MockBookmarkOps();
    const parentId = await bookmarkOps.ensureFolderPath(['開発']);
    await bookmarkOps.create({ url: 'https://a.example.com', title: 'A', parentId });
    const aliasOps = new MockAliasOps();
    await aliasOps.upsert('https://a.example.com', ['えー']);
    const service = new ImportExportService(testNormalizer, bookmarkOps, aliasOps);

    const json = await service.exportJson();
    const parsed = parseJsonFile(json);

    expect(parsed).toEqual([
      { url: 'https://a.example.com', title: 'A', folderPath: ['開発'], aliases: ['えー'], addedAt: undefined },
    ]);
  });

  it('exportJson → importJson の往復で新規作成として復元される', async () => {
    const sourceOps = new MockBookmarkOps();
    const parentId = await sourceOps.ensureFolderPath(['開発', 'chrome']);
    await sourceOps.create({ url: 'https://a.example.com', title: 'A', parentId });
    const sourceAliases = new MockAliasOps();
    await sourceAliases.upsert('https://a.example.com', ['えー']);
    const exportService = new ImportExportService(testNormalizer, sourceOps, sourceAliases);
    const json = await exportService.exportJson();

    const targetOps = new MockBookmarkOps();
    const targetAliases = new MockAliasOps();
    const importService = new ImportExportService(testNormalizer, targetOps, targetAliases);
    const report = await importService.importJson(json, fixedResolver('skip'));

    expect(report.created).toBe(1);
    expect(targetAliases.records.get('https://a.example.com')).toEqual(['えー']);
  });

  it('exportHtml はフォルダ階層を含む Netscape Bookmark File を出力する', async () => {
    const bookmarkOps = new MockBookmarkOps();
    const parentId = await bookmarkOps.ensureFolderPath(['開発']);
    await bookmarkOps.create({ url: 'https://a.example.com', title: 'A', parentId });
    const service = new ImportExportService(testNormalizer, bookmarkOps, new MockAliasOps());

    const html = await service.exportHtml();

    expect(html).toContain('<H3>開発</H3>');
    expect(html).toContain('HREF="https://a.example.com"');
  });
});

describe('serializeJsonFile との整合', () => {
  it('exportJson の出力は serializeJsonFile と同じ format/version を持つ', async () => {
    const service = new ImportExportService(testNormalizer, new MockBookmarkOps(), new MockAliasOps());
    const json = JSON.parse(await service.exportJson());
    const reference = JSON.parse(serializeJsonFile([]));
    expect(json.format).toBe(reference.format);
    expect(json.version).toBe(reference.version);
  });
});
