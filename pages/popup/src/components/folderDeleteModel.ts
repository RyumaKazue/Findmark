import type { BookmarkNode, TrashInput } from '@extension/storage';

/**
 * フォルダ削除（`folder-delete`）の純粋ロジック。
 *
 * React / `chrome.*` に非依存の純粋関数群であり、`useFolderActions`（React 層）とユニットテスト
 * （`folderDeleteModel.test.ts`）から利用する。既存の pure module（`folderTreeModel.ts` /
 * `selectionModel.ts`）に倣い、宣言は非 export とし、ファイル末尾で export をまとめる。
 *
 * フォルダ削除は「**消す前に部分木を読み替えておく**」操作の集まりになる（削除後はツリーを読めないため、
 * ゴミ箱への退避データ・索引から落とす ID・確認ダイアログの件数は、すべて削除前に確定させる必要がある）。
 * その読み替えを副作用のある手順（`useFolderActions`）から切り離し、木の形に対する不変条件をテストで固定する。
 */

/** 配下の内訳（確認ダイアログの文言用）。**フォルダ自身は数えない**。 */
interface FolderContents {
  /** 配下（サブフォルダ内も含む）のブックマーク総数。 */
  bookmarks: number;
  /** 配下（サブフォルダ内も含む）のフォルダ総数。 */
  folders: number;
}

/** ノードがブックマーク（`url` を持つ）か。フォルダは `url` を持たない（chrome の仕様）。 */
const isBookmark = (node: BookmarkNode): boolean => node.url !== undefined;

/** 配下を深さ優先で辿る（自身は含めない）。走査の重複実装を避けるための内部ヘルパー。 */
const walkDescendants = (node: BookmarkNode, visit: (child: BookmarkNode) => void): void => {
  for (const child of node.children ?? []) {
    visit(child);
    walkDescendants(child, visit);
  }
};

/**
 * 配下のブックマーク数・フォルダ数を数える（確認ダイアログの「中のブックマーク N 件・フォルダ M 件」）。
 * どちらも 0 なら「空フォルダ」であり、確認なしで削除してよい（requirements 決定事項2）。
 */
const countContents = (node: BookmarkNode): FolderContents => {
  let bookmarks = 0;
  let folders = 0;
  walkDescendants(node, child => {
    if (isBookmark(child)) {
      bookmarks++;
    } else {
      folders++;
    }
  });
  return { bookmarks, folders };
};

/** 配下ブックマークの ID 一覧（検索索引から落とす対象）。フォルダ自身・サブフォルダの ID は含めない。 */
const collectBookmarkIds = (node: BookmarkNode): string[] => {
  const ids: string[] = [];
  walkDescendants(node, child => {
    if (isBookmark(child)) {
      ids.push(child.id);
    }
  });
  return ids;
};

/**
 * 配下ブックマークの URL 一覧（別名レコードの除去対象）。
 * 同じ URL が複数のブックマークに登録されていても別名レコードは1つのため、**重複を除いて**返す
 * （同じ URL に対して `AliasStore.remove` を何度も呼ばない）。
 */
const collectBookmarkUrls = (node: BookmarkNode): string[] => {
  const urls = new Set<string>();
  walkDescendants(node, child => {
    if (child.url !== undefined) {
      urls.add(child.url);
    }
  });
  return [...urls];
};

/**
 * 部分木をゴミ箱の退避データ（`kind: 'folder'` + `children` 再帰）へ写像する。
 *
 * - `folderPath` は**削除するフォルダ自身の親までのパス**（＝復元先。`BookmarkService.getFolderPath` と同じ意味論）。
 *   `TrashStore.restore` はこのパスへ `ensureFolderPath` してから、フォルダ自身を作り直して子孫を再帰復元する。
 * - 子孫の `folderPath` は**復元に使われない**（親の作成先に対して相対に作り直されるため）。ここでは
 *   親からの実際の階層を積んで入れておく（ゴミ箱 UI 等で参照されたときに嘘の値にならないようにする）。
 * - 別名は `aliasesOf(url)` で解決して各ブックマークに埋める（復元時に別名まで戻すため）。フォルダの
 *   `aliases` は常に空配列（`TrashItem` の契約）。
 */
const toTrashInput = (node: BookmarkNode, folderPath: string[], aliasesOf: (url: string) => string[]): TrashInput => {
  if (node.url !== undefined) {
    return {
      kind: 'bookmark',
      url: node.url,
      title: node.title,
      folderPath,
      aliases: aliasesOf(node.url),
    };
  }
  return {
    kind: 'folder',
    title: node.title,
    folderPath,
    aliases: [],
    children: (node.children ?? []).map(child => toTrashInput(child, [...folderPath, node.title], aliasesOf)),
  };
};

/** `resolveScopeAfterDelete` の入力。木そのものは受け取らず、判定に必要な値だけを受ける。 */
interface ScopeAfterDeleteArgs {
  /** 現在のスコープ（null = すべて）。 */
  scopeFolderId: string | null;
  /** 削除したフォルダの ID。 */
  deletedId: string;
  /** 削除したフォルダの親 ID（最上位フォルダなら null）。 */
  deletedParentId: string | null;
  /** 現在のスコープの祖先 ID 一覧（`folderTreeModel.collectAncestorIds` の結果）。 */
  scopeAncestorIds: readonly string[];
}

/**
 * 削除後のスコープを解決する（requirements 決定事項4）。
 *
 * 削除したフォルダが**現在のスコープ自身、またはその祖先**なら、スコープの実体が消えているため
 * 削除したフォルダの親へ移す（親が無い＝最上位を消した場合は `null`＝「すべて」）。無関係なフォルダの
 * 削除ではスコープを動かさない（作業中の絞り込みを勝手に変えない）。
 *
 * 木の走査は呼び出し側（既存の `collectAncestorIds`）に任せ、本関数は判定だけを担う。
 */
const resolveScopeAfterDelete = (args: ScopeAfterDeleteArgs): string | null => {
  const { scopeFolderId, deletedId, deletedParentId, scopeAncestorIds } = args;
  if (scopeFolderId === null) {
    return null; // 「すべて」は削除の影響を受けない
  }
  const affected = scopeFolderId === deletedId || scopeAncestorIds.includes(deletedId);
  return affected ? deletedParentId : scopeFolderId;
};

export { countContents, collectBookmarkIds, collectBookmarkUrls, toTrashInput, resolveScopeAfterDelete };
export type { FolderContents, ScopeAfterDeleteArgs };
