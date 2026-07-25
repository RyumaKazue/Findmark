/**
 * 左ペインのフォルダツリー表示用の純粋ロジック（U7 は表示のみ）。
 *
 * `BookmarkService.getTree()`（`BookmarkNode[]`）から、フォルダのみのツリーと配下ブックマーク件数を組み立てる。
 * React・chrome API に依存しない純粋関数。絞り込み・展開永続・多階層省略は U11 の担当。
 * （ファイル名は `FolderTree.tsx` との大小文字衝突を避けるため `folderTreeModel.ts` とする。）
 */
import type { BookmarkNode } from '@extension/storage';

/** 左ペイン表示用のフォルダノード。 */
interface FolderTreeNode {
  id: string;
  title: string;
  /** 配下（直下 + サブフォルダ）のブックマーク総数。 */
  count: number;
  /** 子フォルダ（フォルダのみ。ブックマークは含めない）。 */
  children: FolderTreeNode[];
}

/** `node` の部分木に含まれるブックマーク（url を持つノード）数を数える（純粋・再帰）。 */
const countDescendants = (node: BookmarkNode): number => {
  let n = 0;
  const walk = (nodes: BookmarkNode[] | undefined): void => {
    if (!nodes) {
      return;
    }
    for (const child of nodes) {
      if (child.url !== undefined) {
        n++;
      } else {
        walk(child.children);
      }
    }
  };
  walk(node.children);
  return n;
};

/** `nodes` 直下のフォルダ（url を持たないノード）のみを表示用ノードへ写像する（自己再帰）。 */
const mapFolders = (nodes: BookmarkNode[]): FolderTreeNode[] =>
  nodes
    .filter(child => child.url === undefined)
    .map(folder => ({
      id: folder.id,
      title: folder.title,
      count: countDescendants(folder),
      children: mapFolders(folder.children ?? []),
    }));

/**
 * `getTree()` の結果から、左ペイン表示用のフォルダのみツリーを構築する（純粋）。
 * 真のルート（`parentId` 無し）は畳み、その配下のフォルダを最上位として返す。
 */
const buildFolderTree = (tree: BookmarkNode[]): FolderTreeNode[] => {
  const roots = tree.filter(node => node.parentId === undefined);
  const sources = roots.length > 0 ? roots : tree;
  return sources.flatMap(root => mapFolders(root.children ?? []));
};

/** 全ブックマーク数（左ペイン「すべて」の件数用）。 */
const totalBookmarkCount = (tree: BookmarkNode[]): number =>
  tree.reduce((sum, root) => sum + countDescendants(root), 0);

export { buildFolderTree, countDescendants, totalBookmarkCount };
export type { FolderTreeNode };
