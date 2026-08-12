/**
 * 標準HTML形式（Netscape Bookmark File）の入出力（U15）。
 *
 * `packages/shared` は React/DOM API に依存禁止（repository-structure.md）のため、`DOMParser` を使わず
 * 文字列走査で実装する。Netscape Bookmark File の `<DL><DT><H3>`/`<DT><A HREF>` 入れ子構造は正規のため、
 * 軽量なタグベースの走査で十分に扱える。別名は標準フォーマットに存在しないため常に空配列（PRD 機能11）。
 */
import type { ImportBookmark } from './jsonFormat.js';
import type { BookmarkNode } from '@extension/storage';

/** `&amp;`/`&lt;`/`&gt;`/`&quot;`/`&#39;` の最小限デコード（`&amp;` は最後に処理し二重デコードを避ける）。 */
const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** HTML出力用のエンティティエスケープ（`decodeEntities` の逆）。 */
const escapeEntities = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * パーサが着目するトークン（DL開始/終了・フォルダ見出し・ブックマークリンク）を1つの正規表現で拾う。
 * `<DL>` は `<DL COMPACT>` のような属性付きバリエーションも許容する（`<A>`/`<H3>` と同じ寛容さに揃える）。
 */
const TOKEN_RE = /(<DL[^>]*>)|(<\/DL>)|<H3[^>]*>([\s\S]*?)<\/H3>|<A\s+[^>]*?HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>/gi;

/**
 * Netscape Bookmark File のテキストを `ImportBookmark[]` へ変換する。
 *
 * `<H3>` は直後に続く `<DL>` の見出し（フォルダ名）として扱う。`<H3>` を見てから次の `<DL>` が来るまでの
 * 間に他のトークンは現れない（正規の構造）ため、「直前の H3 を保留し、次の DL でスタックへ積む」方式で
 * 階層を復元する。`</DL>` でスタックを1段戻す。トップレベル（見出しの無い最外周 `<DL>`）は `folderPath: []`
 * のまま扱う（真のルートを畳む既存の索引構築と同じ考え方）。
 */
const parseHtmlFile = (html: string): ImportBookmark[] => {
  const bookmarks: ImportBookmark[] = [];
  const stack: string[] = [];
  let pendingFolderName: string | null = null;

  for (const match of html.matchAll(TOKEN_RE)) {
    const [, dlOpen, dlClose, h3Title, href, aTitle] = match;
    if (dlOpen !== undefined) {
      // 直前に <H3> があれば、この <DL> はその子階層。無ければ見出し無しの最外周（何も積まない）。
      if (pendingFolderName !== null) {
        stack.push(pendingFolderName);
        pendingFolderName = null;
      }
      continue;
    }
    if (dlClose !== undefined) {
      stack.pop();
      continue;
    }
    if (h3Title !== undefined) {
      pendingFolderName = decodeEntities(h3Title).trim();
      continue;
    }
    if (href !== undefined) {
      bookmarks.push({
        url: decodeEntities(href),
        title: decodeEntities(aTitle ?? '').trim(),
        folderPath: [...stack],
        aliases: [],
      });
    }
  }

  return bookmarks;
};

/** `dateAdded`（epoch ms）を Netscape 形式の `ADD_DATE`（epoch 秒）へ変換する。無ければ属性を省略する。 */
const addDateAttr = (dateAdded: number | undefined): string =>
  dateAdded !== undefined ? ` ADD_DATE="${Math.floor(dateAdded / 1000)}"` : '';

const HTML_HEADER = [
  '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
  '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
  '<TITLE>Bookmarks</TITLE>',
  '<H1>Bookmarks</H1>',
].join('\n');

/**
 * `BookmarkNode[]`（`BookmarkService.getTree()` の結果）から Netscape Bookmark File のテキストを生成する。
 * 別名は標準フォーマットに無いため出力しない（PRD 機能11）。真のルート（`parentId` 無し）は見出しを
 * 出さずその子から始める（`SearchEngine`/`folderTreeModel` の「真のルートは畳む」規約と同じ）。
 */
const serializeHtmlFile = (tree: BookmarkNode[]): string => {
  const lines: string[] = [HTML_HEADER, '<DL><p>'];

  const walk = (nodes: BookmarkNode[], indent: string): void => {
    for (const node of nodes) {
      if (node.url !== undefined) {
        lines.push(
          `${indent}<DT><A HREF="${escapeEntities(node.url)}"${addDateAttr(node.dateAdded)}>${escapeEntities(node.title)}</A>`,
        );
        continue;
      }
      if (!node.children) {
        continue;
      }
      lines.push(`${indent}<DT><H3>${escapeEntities(node.title)}</H3>`);
      lines.push(`${indent}<DL><p>`);
      walk(node.children, indent + '    ');
      lines.push(`${indent}</DL><p>`);
    }
  };

  const roots = tree.filter(node => node.parentId === undefined);
  const sources = roots.length > 0 ? roots : tree;
  for (const root of sources) {
    walk(root.children ?? [], '    ');
  }

  lines.push('</DL><p>');
  return lines.join('\n');
};

export { parseHtmlFile, serializeHtmlFile };
