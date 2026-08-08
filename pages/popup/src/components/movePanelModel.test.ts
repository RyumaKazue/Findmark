import { buildMoveCandidates, clampIndex, filterCandidates } from './movePanelModel.js';
import { describe, expect, it } from 'vitest';
import type { FolderTreeNode } from './folderTreeModel.js';

/** テスト用フォルダツリー: 開発 >(chrome, ツール) / 料理。 */
const folders: FolderTreeNode[] = [
  {
    id: '2',
    title: '開発',
    count: 3,
    children: [
      { id: '3', title: 'chrome', count: 1, children: [] },
      { id: '6', title: 'ツール', count: 2, children: [] },
    ],
  },
  { id: '4', title: '料理', count: 1, children: [] },
];

/** テスト用の正規化（小文字化のみ。normalizeText 相当の最小版）。 */
const normalize = (s: string): string => s.toLowerCase();

describe('buildMoveCandidates', () => {
  it('深さ優先でフラット化し、各候補にフルパスを付与する', () => {
    const candidates = buildMoveCandidates(folders, null);
    expect(candidates.map(c => c.id)).toEqual(['2', '3', '6', '4']);
    expect(candidates.find(c => c.id === '3')?.path).toEqual(['開発', 'chrome']);
    expect(candidates.find(c => c.id === '4')?.path).toEqual(['料理']);
  });

  it('現在の親フォルダを disabled にし、他は enabled', () => {
    const candidates = buildMoveCandidates(folders, '3');
    expect(candidates.find(c => c.id === '3')?.disabled).toBe(true);
    expect(candidates.filter(c => c.id !== '3').every(c => !c.disabled)).toBe(true);
  });

  it('現在の親が候補にも残る（存在を隠さない）', () => {
    const candidates = buildMoveCandidates(folders, '3');
    expect(candidates.some(c => c.id === '3')).toBe(true);
  });
});

describe('filterCandidates', () => {
  const candidates = buildMoveCandidates(folders, null);

  it('空クエリは全件を返す', () => {
    expect(filterCandidates(candidates, '', normalize)).toHaveLength(candidates.length);
    expect(filterCandidates(candidates, '   ', normalize)).toHaveLength(candidates.length);
  });

  it('末尾フォルダ名の部分一致で絞り込む', () => {
    expect(filterCandidates(candidates, 'chrome', normalize).map(c => c.id)).toEqual(['3']);
  });

  it('大小文字を正規化して一致させる', () => {
    expect(filterCandidates(candidates, 'CHROME', normalize).map(c => c.id)).toEqual(['3']);
  });

  it('フルパス（親フォルダ名）でも一致する', () => {
    // 「開発」で親グループを辿ると、開発自身とその子（chrome/ツール）が通る。
    expect(
      filterCandidates(candidates, '開発', normalize)
        .map(c => c.id)
        .sort(),
    ).toEqual(['2', '3', '6']);
  });

  it('一致しないクエリは空', () => {
    expect(filterCandidates(candidates, 'zzz', normalize)).toEqual([]);
  });
});

describe('clampIndex', () => {
  it('範囲内はそのまま', () => {
    expect(clampIndex(2, 5)).toBe(2);
  });

  it('下限・上限でクランプする', () => {
    expect(clampIndex(-1, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
  });

  it('空リストは 0', () => {
    expect(clampIndex(3, 0)).toBe(0);
  });
});
