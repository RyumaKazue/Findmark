import { buildFolderTree, countDescendants, totalBookmarkCount } from './folderTreeModel.js';
import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '@extension/storage';

// 実 chrome 構造を模した getTree() 相当のツリー:
// root '0'(親なし)
//  └ 'ブックマークバー'(1)
//       ├ 'GitHub'(bm, url)
//       └ '開発'(2)
//            ├ 'aws'(3)  … 空フォルダ
//            └ 'chrome'(4)
//                 ├ 'Docs'(bm, url)
//                 └ 'MV3'(bm, url)
const tree: BookmarkNode[] = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        parentId: '0',
        title: 'ブックマークバー',
        children: [
          { id: 'bm1', parentId: '1', title: 'GitHub', url: 'https://github.com' },
          {
            id: '2',
            parentId: '1',
            title: '開発',
            children: [
              { id: '3', parentId: '2', title: 'aws', children: [] },
              {
                id: '4',
                parentId: '2',
                title: 'chrome',
                children: [
                  { id: 'bm2', parentId: '4', title: 'Docs', url: 'https://developer.chrome.com/docs' },
                  { id: 'bm3', parentId: '4', title: 'MV3', url: 'https://developer.chrome.com/mv3' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

describe('countDescendants', () => {
  it('部分木内のブックマーク（url を持つノード）を再帰的に数える', () => {
    const bar = tree[0].children![0]; // ブックマークバー
    expect(countDescendants(bar)).toBe(3); // GitHub + Docs + MV3
    const dev = bar.children![1]; // 開発
    expect(countDescendants(dev)).toBe(2); // Docs + MV3
  });

  it('空フォルダは 0', () => {
    const dev = tree[0].children![0].children![1];
    const aws = dev.children![0];
    expect(countDescendants(aws)).toBe(0);
  });
});

describe('buildFolderTree', () => {
  const folders = buildFolderTree(tree);

  it('真のルートを畳み、その配下のフォルダを最上位に返す', () => {
    expect(folders.map(f => f.title)).toEqual(['ブックマークバー']);
  });

  it('ブックマーク（url ノード）はツリーに含めず、フォルダのみを子に持つ', () => {
    const bar = folders[0];
    // 'GitHub'(bm) は含まず '開発' のみ
    expect(bar.children.map(f => f.title)).toEqual(['開発']);
    const dev = bar.children[0];
    expect(dev.children.map(f => f.title)).toEqual(['aws', 'chrome']);
  });

  it('件数は配下（直下+サブフォルダ）のブックマークを合算する', () => {
    const bar = folders[0];
    expect(bar.count).toBe(3);
    const dev = bar.children[0];
    expect(dev.count).toBe(2);
    const chrome = dev.children[1];
    expect(chrome.count).toBe(2);
    const aws = dev.children[0];
    expect(aws.count).toBe(0);
  });
});

describe('totalBookmarkCount', () => {
  it('ツリー全体のブックマーク数を返す（「すべて」の件数）', () => {
    expect(totalBookmarkCount(tree)).toBe(3);
  });
});
