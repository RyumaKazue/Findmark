import type { BookmarkNode } from '../types.js';

/**
 * `chrome.bookmarks` / `chrome.tabs` / `chrome.runtime` の薄いラッパ。
 *
 * chrome API アクセスをデータレイヤーに閉じ込め、UI/サービス層が `chrome.*` を直接
 * 触らずに済むようにする（architecture.md のレイヤー依存 UI→サービス→データ）。特に
 * `faviconUrl` は `chrome.runtime.id` を要するため、URL 生成をここに集約する。
 */
export class BookmarkService {
  private get bookmarks() {
    return globalThis.chrome.bookmarks;
  }

  private get tabs() {
    return globalThis.chrome.tabs;
  }

  private get runtime() {
    return globalThis.chrome.runtime;
  }

  /** chrome の BookmarkTreeNode をドメイン `BookmarkNode` へ写像する（必要フィールドのみ・children 再帰）。 */
  private toDomain(node: chrome.bookmarks.BookmarkTreeNode): BookmarkNode {
    return {
      id: node.id,
      parentId: node.parentId,
      title: node.title,
      url: node.url,
      dateAdded: node.dateAdded,
      children: node.children?.map(child => this.toDomain(child)),
    };
  }

  /** ブックマークツリー全体を取得する。 */
  async getTree(): Promise<BookmarkNode[]> {
    const tree = await this.bookmarks.getTree();
    return tree.map(node => this.toDomain(node));
  }

  /**
   * `nodeId` を格納しているフォルダのパス（フォルダ名の配列・上位→末端）を返す。
   *
   * - `nodeId` 自身のタイトルは含めない（親フォルダから辿る）。ブックマークの id を渡すと
   *   「そのブックマークが入っているフォルダ階層」が得られる。
   * - トップレベルフォルダ（例: 「ブックマーク バー」「その他のブックマーク」）は含める。
   * - 真のルート（`parentId` を持たないノード）は含めない。
   *
   * この結果は `ensureFolderPath` の入力と往復整合する（`ensureFolderPath(getFolderPath(id))` で
   * 元の格納フォルダを再現できる）。U15/U16（インポート/ゴミ箱復元）が依存する契約。
   * 例: 「バー > 開発 > chrome」内のブックマークなら `['ブックマーク バー','開発','chrome']`。
   */
  async getFolderPath(nodeId: string): Promise<string[]> {
    const path: string[] = [];
    const [node]: chrome.bookmarks.BookmarkTreeNode[] = await this.bookmarks.get(nodeId);
    // 自身は含めず、親フォルダから上へ辿る。
    let currentId: string | undefined = node?.parentId;
    while (currentId) {
      const [ancestor]: chrome.bookmarks.BookmarkTreeNode[] = await this.bookmarks.get(currentId);
      if (!ancestor || ancestor.parentId === undefined) {
        // 真のルートはパスに含めない。
        break;
      }
      path.unshift(ancestor.title);
      currentId = ancestor.parentId;
    }
    return path;
  }

  /**
   * フォルダパス（`getFolderPath` と同じ意味論: トップレベルフォルダを含む）を真のルートから
   * 上から辿り、無い階層は自動作成して末端フォルダの ID を返す。
   *
   * - トップレベルフォルダ（「ブックマーク バー」等）は既存を再利用する（ルート直下には作成しない）。
   * - 空配列の場合は既定の書き込み先（ブックマークバー = ルートの最初の子）の ID を返す（何も作成しない）。
   */
  async ensureFolderPath(path: string[]): Promise<string> {
    const root = await this.getRoot();
    if (path.length === 0) {
      return this.defaultParentId(root);
    }
    let parentId = root.id;
    for (const title of path) {
      const children = await this.bookmarks.getChildren(parentId);
      // フォルダ（url を持たないノード）で同名のものを再利用する。
      const existing = children.find(child => child.url === undefined && child.title === title);
      if (existing) {
        parentId = existing.id;
      } else {
        const created = await this.bookmarks.create({ parentId, title });
        parentId = created.id;
      }
    }
    return parentId;
  }

  /** ブックマーク/フォルダを作成する（`url` 未指定ならフォルダ）。 */
  async create(data: { url?: string; title: string; parentId: string }): Promise<BookmarkNode> {
    const created = await this.bookmarks.create(data);
    return this.toDomain(created);
  }

  /** タイトルを変更する。 */
  async rename(id: string, title: string): Promise<void> {
    await this.bookmarks.update(id, { title });
  }

  /** URL を変更する。 */
  async updateUrl(id: string, url: string): Promise<void> {
    await this.bookmarks.update(id, { url });
  }

  /** 別フォルダへ移動する。 */
  async move(id: string, parentId: string): Promise<void> {
    await this.bookmarks.move(id, { parentId });
  }

  /** ブックマーク/フォルダを削除する。 */
  async remove(id: string): Promise<void> {
    await this.bookmarks.remove(id);
  }

  /**
   * アクティブタブの URL / タイトルを返す。
   * `chrome://` 等で activeTab 権限が付与されず url/title が取れない場合は空文字にフォールバックする。
   */
  async getCurrentTab(): Promise<{ url: string; title: string }> {
    const [tab] = await this.tabs.query({ active: true, currentWindow: true });
    return { url: tab?.url ?? '', title: tab?.title ?? '' };
  }

  /**
   * ファビコン取得用の URL を組み立てて返す（同期）。
   * `chrome-extension://<runtime.id>/_favicon/?pageUrl=...&size=...` を生成し、
   * `chrome.runtime.id` へのアクセスをデータ層に閉じ込める。UI はこの文字列を `<img src>` に渡すだけ。
   */
  faviconUrl(pageUrl: string, size = 16): string {
    const url = new URL(this.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', String(size));
    return url.toString();
  }

  /** ブックマークツリーの真のルートノードを返す。 */
  private async getRoot(): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const [root] = await this.bookmarks.getTree();
    return root;
  }

  /** 既定の書き込み先（ブックマークバー = ルートの最初の子）の ID を返す。 */
  private defaultParentId(root: chrome.bookmarks.BookmarkTreeNode): string {
    const bar = root.children?.[0];
    if (!bar) {
      throw new Error('ブックマークのベースフォルダ（ブックマークバー）が見つかりません');
    }
    return bar.id;
  }
}

/** 既定の BookmarkService インスタンス。状態を持たないため使い回して問題ない。 */
export const bookmarkService = new BookmarkService();
