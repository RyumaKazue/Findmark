import { parseHtmlFile, serializeHtmlFile } from './htmlFormat.js';
import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '@extension/storage';

const sampleHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>開発</H3>
    <DL><p>
        <DT><A HREF="https://developer.chrome.com/docs/extensions/" ADD_DATE="1730000000">Chrome Extensions Docs</A>
        <DT><H3>chrome</H3>
        <DL><p>
            <DT><A HREF="https://developer.chrome.com/docs/extensions/reference">Extension API Reference</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://root-level.example.com">Root Level Bookmark</A>
</DL><p>
`;

describe('parseHtmlFile — ネスト構造のパース', () => {
  it('フォルダ階層を folderPath として復元する', () => {
    const result = parseHtmlFile(sampleHtml);
    const docs = result.find(b => b.title === 'Chrome Extensions Docs');
    expect(docs?.folderPath).toEqual(['開発']);

    const ref = result.find(b => b.title === 'Extension API Reference');
    expect(ref?.folderPath).toEqual(['開発', 'chrome']);
  });

  it('見出しの無い最外周直下のブックマークは folderPath: []', () => {
    const result = parseHtmlFile(sampleHtml);
    const rootLevel = result.find(b => b.title === 'Root Level Bookmark');
    expect(rootLevel?.folderPath).toEqual([]);
  });

  it('別名は常に空配列', () => {
    const result = parseHtmlFile(sampleHtml);
    expect(result.every(b => b.aliases.length === 0)).toBe(true);
  });

  it('URL を正しく取得する', () => {
    const result = parseHtmlFile(sampleHtml);
    const docs = result.find(b => b.title === 'Chrome Extensions Docs');
    expect(docs?.url).toBe('https://developer.chrome.com/docs/extensions/');
  });

  it('全件数が正しい', () => {
    expect(parseHtmlFile(sampleHtml)).toHaveLength(3);
  });

  it('属性付き <DL COMPACT> でも階層を正しく復元する（他ツール由来のバリエーション対応）', () => {
    const html = `<DL COMPACT><p>
      <DT><H3>開発</H3>
      <DL COMPACT><p>
        <DT><A HREF="https://a.example.com">A</A>
      </DL><p>
    </DL><p>`;
    const result = parseHtmlFile(html);
    expect(result).toEqual([{ url: 'https://a.example.com', title: 'A', folderPath: ['開発'], aliases: [] }]);
  });
});

describe('parseHtmlFile — HTMLエンティティのデコード', () => {
  it('&amp; / &lt; / &gt; / &quot; / &#39; をデコードする', () => {
    const html = `<DL><p>
      <DT><A HREF="https://example.com/?a=1&amp;b=2">Fish &amp; Chips &lt;Best&gt; &quot;Ever&quot; &#39;yo&#39;</A>
    </DL><p>`;
    const result = parseHtmlFile(html);
    expect(result[0].url).toBe('https://example.com/?a=1&b=2');
    expect(result[0].title).toBe(`Fish & Chips <Best> "Ever" 'yo'`);
  });
});

describe('serializeHtmlFile', () => {
  const bookmark: BookmarkNode = {
    id: '10',
    parentId: '3',
    title: 'Extension API Reference',
    url: 'https://developer.chrome.com/docs/extensions/reference',
  };
  const chromeFolder: BookmarkNode = { id: '3', parentId: '2', title: 'chrome', children: [bookmark] };
  const devFolder: BookmarkNode = { id: '2', parentId: '1', title: '開発', children: [chromeFolder] };
  const bar: BookmarkNode = { id: '1', parentId: '0', title: 'ブックマーク バー', children: [devFolder] };
  const root: BookmarkNode = { id: '0', title: '', children: [bar] };
  const tree = [root];

  it('真のルートは見出しを出さず、その子（ブックマーク バー）から始める', () => {
    const html = serializeHtmlFile(tree);
    expect(html).toContain('<H3>ブックマーク バー</H3>');
    expect(html).not.toContain('<H3></H3>');
  });

  it('フォルダ階層を <DL> の入れ子として出力する', () => {
    const html = serializeHtmlFile(tree);
    expect(html).toContain('<H3>開発</H3>');
    expect(html).toContain('<H3>chrome</H3>');
    expect(html).toContain('<A HREF="https://developer.chrome.com/docs/extensions/reference"');
  });

  it('別名は出力に含まれない（別名フィールド自体が存在しない）', () => {
    const html = serializeHtmlFile(tree);
    expect(html).not.toMatch(/alias/i);
  });

  it('URL/タイトルはエンティティエスケープして出力する', () => {
    const special: BookmarkNode = {
      id: '20',
      parentId: '0',
      title: 'Fish & Chips <Best>',
      url: 'https://example.com/?a=1&b=2',
    };
    const html = serializeHtmlFile([{ id: '0', title: '', children: [special] }]);
    expect(html).toContain('Fish &amp; Chips &lt;Best&gt;');
    expect(html).toContain('HREF="https://example.com/?a=1&amp;b=2"');
  });
});

describe('parseHtmlFile ⇄ serializeHtmlFile 往復', () => {
  it('serialize した結果を再度 parse すると同じフォルダ階層・URL集合になる', () => {
    const bookmark: BookmarkNode = { id: '10', parentId: '3', title: 'Ref', url: 'https://a.example.com/ref' };
    const chromeFolder: BookmarkNode = { id: '3', parentId: '2', title: 'chrome', children: [bookmark] };
    const devFolder: BookmarkNode = { id: '2', parentId: '1', title: '開発', children: [chromeFolder] };
    const bar: BookmarkNode = { id: '1', parentId: '0', title: 'ブックマーク バー', children: [devFolder] };
    const tree = [{ id: '0', title: '', children: [bar] } satisfies BookmarkNode];

    const html = serializeHtmlFile(tree);
    const parsed = parseHtmlFile(html);

    expect(parsed).toEqual([
      {
        url: 'https://a.example.com/ref',
        title: 'Ref',
        folderPath: ['ブックマーク バー', '開発', 'chrome'],
        aliases: [],
      },
    ]);
  });
});
