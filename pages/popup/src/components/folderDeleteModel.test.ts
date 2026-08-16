import {
  collectBookmarkIds,
  collectBookmarkUrls,
  countContents,
  resolveScopeAfterDelete,
  toTrashInput,
} from './folderDeleteModel.js';
import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '@extension/storage';

/** テスト用のフォルダノード。 */
const folder = (id: string, title: string, children: BookmarkNode[] = []): BookmarkNode => ({
  id,
  title,
  children,
});

/** テスト用のブックマークノード。 */
const bookmark = (id: string, title: string, url: string): BookmarkNode => ({ id, title, url });

/**
 * 「chrome」フォルダ:
 *   chrome
 *   ├ Docs                 (b1 / https://a.test)
 *   ├ extensions           (フォルダ)
 *   │  ├ MV3               (b2 / https://b.test)
 *   │  └ 重複              (b3 / https://a.test  ← URL 重複)
 *   └ empty                (空フォルダ)
 */
const tree = folder('f1', 'chrome', [
  bookmark('b1', 'Docs', 'https://a.test'),
  folder('f2', 'extensions', [bookmark('b2', 'MV3', 'https://b.test'), bookmark('b3', '重複', 'https://a.test')]),
  folder('f3', 'empty'),
]);

describe('countContents（配下の内訳）', () => {
  it('空フォルダは 0 件 / 0 フォルダ（確認ダイアログを出さない条件）', () => {
    expect(countContents(folder('x', 'empty'))).toEqual({ bookmarks: 0, folders: 0 });
  });

  it('children が undefined でも 0 件を返す', () => {
    expect(countContents({ id: 'x', title: 'no-children' })).toEqual({ bookmarks: 0, folders: 0 });
  });

  it('直下のみのフォルダを数える', () => {
    const node = folder('x', 'flat', [bookmark('b1', 'A', 'https://a.test'), bookmark('b2', 'B', 'https://b.test')]);
    expect(countContents(node)).toEqual({ bookmarks: 2, folders: 0 });
  });

  it('孫まで再帰的に数える（自分自身は含めない）', () => {
    expect(countContents(tree)).toEqual({ bookmarks: 3, folders: 2 });
  });

  it('サブフォルダしか無い場合はブックマーク0件・フォルダのみを数える', () => {
    const node = folder('x', 'only-folders', [folder('y', 'a', [folder('z', 'b')])]);
    expect(countContents(node)).toEqual({ bookmarks: 0, folders: 2 });
  });
});

describe('collectBookmarkIds（索引から落とす対象）', () => {
  it('配下ブックマークの ID を深いネストまで集める', () => {
    expect(collectBookmarkIds(tree).sort()).toEqual(['b1', 'b2', 'b3']);
  });

  it('フォルダ自身・サブフォルダの ID は含めない', () => {
    const ids = collectBookmarkIds(tree);
    expect(ids).not.toContain('f1');
    expect(ids).not.toContain('f2');
    expect(ids).not.toContain('f3');
  });

  it('空フォルダでは空配列', () => {
    expect(collectBookmarkIds(folder('x', 'empty'))).toEqual([]);
  });
});

describe('collectBookmarkUrls（別名レコードの除去対象）', () => {
  it('重複 URL を1つにまとめる（同じ URL に remove を二重に呼ばない）', () => {
    expect(collectBookmarkUrls(tree).sort()).toEqual(['https://a.test', 'https://b.test']);
  });

  it('空フォルダでは空配列', () => {
    expect(collectBookmarkUrls(folder('x', 'empty'))).toEqual([]);
  });
});

describe('toTrashInput（ゴミ箱への退避データ）', () => {
  const aliasesOf = (url: string) => (url === 'https://a.test' ? ['えー', 'a'] : []);

  it('フォルダは kind:folder・aliases 空・復元先パスを持つ', () => {
    const input = toTrashInput(tree, ['ブックマーク バー', '開発'], aliasesOf);
    expect(input.kind).toBe('folder');
    expect(input.title).toBe('chrome');
    expect(input.folderPath).toEqual(['ブックマーク バー', '開発']);
    expect(input.aliases).toEqual([]);
    expect(input.url).toBeUndefined();
  });

  it('子孫を再帰的に写像する（フォルダの入れ子を保つ）', () => {
    const input = toTrashInput(tree, [], aliasesOf);
    expect(input.children).toHaveLength(3);
    const extensions = input.children?.[1];
    expect(extensions?.kind).toBe('folder');
    expect(extensions?.title).toBe('extensions');
    expect(extensions?.children).toHaveLength(2);
    expect(extensions?.children?.[0]).toMatchObject({ kind: 'bookmark', title: 'MV3', url: 'https://b.test' });
  });

  it('ブックマークには別名を埋める（復元時に別名まで戻すため）', () => {
    const input = toTrashInput(tree, [], aliasesOf);
    expect(input.children?.[0]).toMatchObject({ kind: 'bookmark', url: 'https://a.test', aliases: ['えー', 'a'] });
    expect(input.children?.[1]?.children?.[0]?.aliases).toEqual([]);
  });

  it('子孫の folderPath は親からの実際の階層を積む', () => {
    const input = toTrashInput(tree, ['バー'], aliasesOf);
    expect(input.children?.[0]?.folderPath).toEqual(['バー', 'chrome']);
    expect(input.children?.[1]?.children?.[0]?.folderPath).toEqual(['バー', 'chrome', 'extensions']);
  });

  it('空フォルダは children が空配列', () => {
    const input = toTrashInput(folder('x', 'empty'), [], aliasesOf);
    expect(input.children).toEqual([]);
  });
});

describe('resolveScopeAfterDelete（削除後のスコープ）', () => {
  it('削除対象がスコープ自身なら親へ移す', () => {
    expect(
      resolveScopeAfterDelete({
        scopeFolderId: 'f1',
        deletedId: 'f1',
        deletedParentId: 'parent',
        scopeAncestorIds: ['parent'],
      }),
    ).toBe('parent');
  });

  it('削除対象がスコープの祖先ならスコープごと消えるため親へ移す', () => {
    expect(
      resolveScopeAfterDelete({
        scopeFolderId: 'child',
        deletedId: 'f1',
        deletedParentId: 'parent',
        scopeAncestorIds: ['parent', 'f1'],
      }),
    ).toBe('parent');
  });

  it('最上位フォルダを削除した場合は「すべて」へ倒す', () => {
    expect(
      resolveScopeAfterDelete({
        scopeFolderId: 'f1',
        deletedId: 'f1',
        deletedParentId: null,
        scopeAncestorIds: [],
      }),
    ).toBeNull();
  });

  it('無関係なフォルダの削除ではスコープを動かさない', () => {
    expect(
      resolveScopeAfterDelete({
        scopeFolderId: 'keep',
        deletedId: 'other',
        deletedParentId: 'parent',
        scopeAncestorIds: ['ancestor'],
      }),
    ).toBe('keep');
  });

  it('スコープが「すべて」なら常に「すべて」のまま', () => {
    expect(
      resolveScopeAfterDelete({
        scopeFolderId: null,
        deletedId: 'other',
        deletedParentId: 'parent',
        scopeAncestorIds: [],
      }),
    ).toBeNull();
  });
});
