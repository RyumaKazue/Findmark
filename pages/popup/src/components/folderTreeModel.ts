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

// ── U11: 左ペインのキーボード操作用の純粋ロジック ───────────────────────────────

/** 深さ省略（design 2b）を始める子グループの深さ（0 起点。= 第5階層）。 */
const TRUNCATE_DEPTH = 4;
/** 省略時に表示する先頭件数（design README「State Management」の「さらに N 件…」）。 */
const VISIBLE_CHILDREN = 2;

/** 左ペインの可視行1件（キーボード移動の単位）。 */
type TreeRow =
  | { kind: 'all' } // 「すべて」行（scope = null）
  | { kind: 'folder'; folder: FolderTreeNode; depth: number } // フォルダ行（scope = folder.id）
  | { kind: 'more'; parentId: string; hiddenCount: number; depth: number }; // 「さらに N 件…」行

interface FlattenOptions {
  /** 展開中のフォルダ ID。 */
  expandedIds: ReadonlySet<string>;
  /** 「さらに N 件…」を押して全件表示にした親フォルダ ID（非永続）。 */
  revealedIds: ReadonlySet<string>;
}

/** 行のキー（React key / フォーカス同定用）。'all' | `f:${id}` | `more:${parentId}` */
const rowKey = (row: TreeRow): string =>
  row.kind === 'all' ? 'all' : row.kind === 'folder' ? `f:${row.folder.id}` : `more:${row.parentId}`;

/**
 * 展開状態と深さ省略（design 2b）を反映し、左ペインの可視行をフラット化する（純粋）。
 * 先頭は必ず `{ kind: 'all' }`。展開中フォルダのみ子を展開し、深さ `TRUNCATE_DEPTH` 以降の子グループは
 * 親が `revealedIds` に無い限り先頭 `VISIBLE_CHILDREN` 件で打ち切り、`{ kind: 'more' }` を1行足す。
 */
const flattenVisibleTree = (folders: FolderTreeNode[], options: FlattenOptions): TreeRow[] => {
  const rows: TreeRow[] = [{ kind: 'all' }];

  const emitChildren = (parent: FolderTreeNode, childDepth: number): void => {
    const children = parent.children;
    const truncate = childDepth >= TRUNCATE_DEPTH && !options.revealedIds.has(parent.id);
    const shown = truncate ? children.slice(0, VISIBLE_CHILDREN) : children;
    for (const child of shown) {
      emitFolder(child, childDepth);
    }
    if (truncate && children.length > VISIBLE_CHILDREN) {
      rows.push({
        kind: 'more',
        parentId: parent.id,
        hiddenCount: children.length - VISIBLE_CHILDREN,
        depth: childDepth,
      });
    }
  };

  const emitFolder = (folder: FolderTreeNode, depth: number): void => {
    rows.push({ kind: 'folder', folder, depth });
    if (folder.children.length > 0 && options.expandedIds.has(folder.id)) {
      emitChildren(folder, depth + 1);
    }
  };

  for (const folder of folders) {
    emitFolder(folder, 0);
  }
  return rows;
};

/** 現在の行キーから ±1 行移動した先の行を返す（端では null）。 */
const moveRow = (rows: TreeRow[], currentKey: string, delta: -1 | 1): TreeRow | null => {
  const index = rows.findIndex(row => rowKey(row) === currentKey);
  if (index < 0) {
    return null;
  }
  const next = index + delta;
  if (next < 0 || next >= rows.length) {
    return null;
  }
  return rows[next];
};

/** 親フォルダ ID を返す（最上位フォルダ・不明は null）。 */
const findParentId = (folders: FolderTreeNode[], folderId: string): string | null => {
  let result: string | null = null;
  const walk = (nodes: FolderTreeNode[], parentId: string | null): boolean => {
    for (const node of nodes) {
      if (node.id === folderId) {
        result = parentId;
        return true;
      }
      if (walk(node.children, node.id)) {
        return true;
      }
    }
    return false;
  };
  walk(folders, null);
  return result;
};

/** ルートから当該フォルダまでの祖先 ID（自身は含まない）。見つからなければ空配列。 */
const collectAncestorIds = (folders: FolderTreeNode[], folderId: string): string[] => {
  let result: string[] = [];
  const walk = (nodes: FolderTreeNode[], ancestors: string[]): boolean => {
    for (const node of nodes) {
      if (node.id === folderId) {
        result = ancestors;
        return true;
      }
      if (walk(node.children, [...ancestors, node.id])) {
        return true;
      }
    }
    return false;
  };
  walk(folders, []);
  return result;
};

/**
 * ルートから当該フォルダまでのタイトル配列（自身を含む）。見つからなければ空配列。
 * パスは常に配列で保持し、表示時にのみ結合する（`/` を含む名前でも壊れない = AC-6）。
 */
const findFolderPath = (folders: FolderTreeNode[], folderId: string): string[] => {
  let result: string[] = [];
  const walk = (nodes: FolderTreeNode[], titles: string[]): boolean => {
    for (const node of nodes) {
      const next = [...titles, node.title];
      if (node.id === folderId) {
        result = next;
        return true;
      }
      if (walk(node.children, next)) {
        return true;
      }
    }
    return false;
  };
  walk(folders, []);
  return result;
};

/**
 * 「先頭1階層 + … + 末尾2階層」に圧縮する（design 2b）。深さ4以下はそのまま（2a の表示）。
 * 例: ['開発','tools','samples','mv3','x'] → ['開発','…','mv3','x']
 */
const compressPath = (titles: string[]): string[] => {
  if (titles.length <= 4) {
    return titles;
  }
  return [titles[0], '…', titles[titles.length - 2], titles[titles.length - 1]];
};

/** 表示用に ` / ` で結合する（結合は表示時のみ。保持は常に配列 = AC-6）。 */
const formatPath = (titles: string[]): string => titles.join(' / ');

export {
  buildFolderTree,
  countDescendants,
  totalBookmarkCount,
  flattenVisibleTree,
  rowKey,
  moveRow,
  findParentId,
  collectAncestorIds,
  findFolderPath,
  compressPath,
  formatPath,
  TRUNCATE_DEPTH,
  VISIBLE_CHILDREN,
};
export type { FolderTreeNode, TreeRow, FlattenOptions };
