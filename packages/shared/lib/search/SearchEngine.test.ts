import { normalizer } from './Normalizer.js';
import { SearchEngine } from './SearchEngine.js';
import { describe, expect, it, vi } from 'vitest';
import type { AliasSource, BookmarkTreeSource } from './SearchEngine.js';
import type { AliasRecord, BookmarkNode } from '@extension/storage';

/** テスト用の最小 `BookmarkTreeSource`。 */
const treeSource = (tree: BookmarkNode[]): BookmarkTreeSource => ({ getTree: () => Promise.resolve(tree) });
/** テスト用の最小 `AliasSource`。 */
const aliasSource = (aliasMap: Map<string, AliasRecord>): AliasSource => ({ getAll: () => Promise.resolve(aliasMap) });

const aliasRecord = (url: string, aliases: string[]): [string, AliasRecord] => [
  normalizer.hashUrl(url),
  { urlHash: normalizer.hashUrl(url), url, aliases, updatedAt: 0 },
];

const buildEngine = async (tree: BookmarkNode[], aliasEntries: [string, AliasRecord][] = []): Promise<SearchEngine> => {
  const engine = new SearchEngine(normalizer);
  await engine.loadIndex(treeSource(tree), aliasSource(new Map(aliasEntries)));
  return engine;
};

/* ------------------------------------------------------------------ *
 * メインフィクスチャ
 *
 * ルート(id:0, parentId無し)
 * └ ブックマーク バー(id:1)
 *    ├ GitHub(id:10, url:https://github.com)                         別名: ぎっと, git
 *    ├ 開発(id:2)
 *    │  ├ Chrome拡張のドキュメント(id:11, url:.../docs/extensions)
 *    │  └ chrome(id:3)
 *    │     └ Extension API Reference(id:12, url:.../docs/extensions/reference)
 *    ├ 料理(id:4)
 *    │  └ Cooking Recipe Site(id:13, url:https://recipe.example.com)
 *    ├ A/B(id:5)                                                       ※ '/' を含むフォルダ名
 *    │  └ Slash Folder Test(id:14, url:https://slash.example.com)
 *    └ Invalid URL Bookmark(id:15, url:'not-a-valid-url')              ※ 不正 URL
 * ------------------------------------------------------------------ */

const github: BookmarkNode = { id: '10', parentId: '1', title: 'GitHub', url: 'https://github.com' };
const docsBookmark: BookmarkNode = {
  id: '11',
  parentId: '2',
  title: 'Chrome拡張のドキュメント',
  url: 'https://developer.chrome.com/docs/extensions',
};
const extBookmark: BookmarkNode = {
  id: '12',
  parentId: '3',
  title: 'Extension API Reference',
  url: 'https://developer.chrome.com/docs/extensions/reference',
};
const chromeFolder: BookmarkNode = { id: '3', parentId: '2', title: 'chrome', children: [extBookmark] };
const devFolder: BookmarkNode = { id: '2', parentId: '1', title: '開発', children: [docsBookmark, chromeFolder] };
const recipeBookmark: BookmarkNode = {
  id: '13',
  parentId: '4',
  title: 'Cooking Recipe Site',
  url: 'https://recipe.example.com',
};
const cookingFolder: BookmarkNode = { id: '4', parentId: '1', title: '料理', children: [recipeBookmark] };
const slashBookmark: BookmarkNode = {
  id: '14',
  parentId: '5',
  title: 'Slash Folder Test',
  url: 'https://slash.example.com',
};
const slashFolder: BookmarkNode = { id: '5', parentId: '1', title: 'A/B', children: [slashBookmark] };
const invalidUrlBookmark: BookmarkNode = {
  id: '15',
  parentId: '1',
  title: 'Invalid URL Bookmark',
  url: 'not-a-valid-url',
};

const bar: BookmarkNode = {
  id: '1',
  parentId: '0',
  title: 'ブックマーク バー',
  children: [github, devFolder, cookingFolder, slashFolder, invalidUrlBookmark],
};
const root: BookmarkNode = { id: '0', title: '', children: [bar] };
const mainTree = [root];

const mainAliases: [string, AliasRecord][] = [aliasRecord('https://github.com', ['ぎっと', 'git'])];

describe('SearchEngine — 正規化AND部分一致', () => {
  it('全角半角・大小文字のゆれを正規化して照合する', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: ['ｇｉｔＨＵＢ'] });
    expect(results.map(r => r.node.id)).toEqual(['10']);
  });

  it('複数キーワードをAND条件で照合し、異なるフィールドの一致を組み合わせて絞り込む', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    // 'ドキュメント' はタイトルに、'開発' はフォルダ名にのみ一致する(docsBookmarkのみが両方満たす)。
    const results = engine.search({ keywords: ['ドキュメント', '開発'] });
    expect(results.map(r => r.node.id)).toEqual(['11']);
  });

  it('AND条件のため、一部キーワードのみ一致する項目は除外される', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: ['開発', '存在しない単語xyz'] });
    expect(results).toEqual([]);
  });
});

describe('SearchEngine — 照合フィールド(タイトル/フォルダ名/別名)', () => {
  it('別名のみで一致する(タイトル・フォルダ名に含まれない語)', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: ['ぎっと'] });
    expect(results.map(r => r.node.id)).toEqual(['10']);
    expect(results[0].matchedFields).toEqual(['alias']);
    expect(results[0].matchedAliases).toEqual(['ぎっと']);
  });

  it('フォルダ名のみで一致する(サブツリー配下も含む)', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: ['開発'] });
    // 直下(docsBookmark)とネストした子孫(extBookmark)の両方がヒットする(サブツリー全体照合)。
    expect(results.map(r => r.node.id).sort()).toEqual(['11', '12']);
    for (const r of results) {
      expect(r.matchedFields).toEqual(['folder']);
      expect(r.matchedAliases).toEqual([]);
    }
  });

  it('タイトルのみで一致する', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: ['cooking'] });
    expect(results.map(r => r.node.id)).toEqual(['13']);
    expect(results[0].matchedFields).toEqual(['title']);
  });

  it('同点のときはタイトル昇順で安定ソートされる', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: ['開発'] });
    expect(results.map(r => r.node.title)).toEqual(['Chrome拡張のドキュメント', 'Extension API Reference']);
  });
});

describe('SearchEngine — folderScope(範囲フィルタ・常に直下のみ・照合対象からは除外)', () => {
  it('指定フォルダの直下のみに絞る', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: [], folderScope: { folderId: '2' } });
    expect(results.map(r => r.node.id)).toEqual(['11']);
  });

  it('サブフォルダ配下は範囲に含まれない(孫は対象外)', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: [], folderScope: { folderId: '2' } });
    expect(results.map(r => r.node.id)).not.toContain('12');
  });

  it('フォルダ名に "/" を含んでいても範囲フィルタが壊れない', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: [], folderScope: { folderId: '5' } });
    expect(results.map(r => r.node.id)).toEqual(['14']);
  });

  it('folderScope は照合対象に含まれない(範囲外にフォルダ名と同じキーワードを入れても無関係の項目はヒットしない)', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    // '料理' というキーワードは料理フォルダ配下(recipeBookmark)にしかヒットしない。
    const results = engine.search({ keywords: ['料理'], folderScope: { folderId: '2' } });
    expect(results).toEqual([]);
  });

  it('folderScope 未指定なら全ブックマークが対象になる(=「すべて」)', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: [] });
    expect(results.map(r => r.node.id).sort()).toEqual(['10', '11', '12', '13', '14', '15']);
  });
});

describe('SearchEngine — スコアリング(一致位置ボーナス)', () => {
  it('完全一致 > 前方一致 > 部分一致の順にスコアが高い', async () => {
    const exact: BookmarkNode = { id: 'e1', parentId: '1', title: 'test', url: 'https://a.example.com/1' };
    const prefix: BookmarkNode = { id: 'e2', parentId: '1', title: 'testing tool', url: 'https://a.example.com/2' };
    const partial: BookmarkNode = { id: 'e3', parentId: '1', title: 'contest site', url: 'https://a.example.com/3' };
    const tree = [
      { id: '0', title: '', children: [{ id: '1', parentId: '0', title: 'bar', children: [exact, prefix, partial] }] },
    ];

    const engine = await buildEngine(tree);
    const results = engine.search({ keywords: ['test'] });

    expect(results.map(r => r.node.id)).toEqual(['e1', 'e2', 'e3']);
    expect(results[0].score).toBe(15); // 10(タイトル) + 5(完全一致)
    expect(results[1].score).toBe(13); // 10(タイトル) + 3(前方一致)
    expect(results[2].score).toBe(10); // 10(タイトル) + 0(部分一致)
  });

  it('同じ一致位置(部分一致)ならタイトル > 別名 > フォルダの順にスコアが高い', async () => {
    const titleHit: BookmarkNode = { id: 'f1', parentId: '1', title: 'zzkeywordzz', url: 'https://b.example.com/1' };
    const aliasHit: BookmarkNode = { id: 'f2', parentId: '1', title: 'unrelated page', url: 'https://b.example.com/2' };
    const folderHit: BookmarkNode = { id: 'f3', parentId: '2', title: 'another page', url: 'https://b.example.com/3' };
    const tree = [
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            parentId: '0',
            title: 'bar',
            children: [titleHit, aliasHit, { id: '2', parentId: '1', title: 'zzkeywordzz', children: [folderHit] }],
          },
        ],
      },
    ];
    const aliases: [string, AliasRecord][] = [aliasRecord('https://b.example.com/2', ['zzkeywordzz'])];

    const engine = await buildEngine(tree, aliases);
    const results = engine.search({ keywords: ['zzkeywordzz'] });

    expect(results.map(r => r.node.id)).toEqual(['f1', 'f2', 'f3']);
    expect(results[0].score).toBe(15); // title: 10 + 完全一致5
    expect(results[1].score).toBe(13); // alias: 8 + 完全一致5
    expect(results[2].score).toBe(9); // folder: 4 + 完全一致5
  });
});

describe('SearchEngine — フォールバック(結果0件時のみ)', () => {
  it('通常検索が1件以上ヒットするときはフォールバックが発火しない', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const spy = vi.spyOn(engine as unknown as { fuzzyFallback: SearchEngine['search'] }, 'fuzzyFallback');
    const results = engine.search({ keywords: ['github'] });
    expect(results.length).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('結果0件のときのみあいまい一致が発火する', async () => {
    const node: BookmarkNode = { id: 'g1', parentId: '1', title: 'documentation', url: 'https://c.example.com/1' };
    const tree = [{ id: '0', title: '', children: [{ id: '1', parentId: '0', title: 'bar', children: [node] }] }];
    const engine = await buildEngine(tree);

    // 'documentaton'(iが1文字欠落)は通常検索では0件だが、あいまい一致で救済される。
    const results = engine.search({ keywords: ['documentaton'] });
    expect(results.map(r => r.node.id)).toEqual(['g1']);
    expect(results[0].score).toBeLessThan(0); // フォールバックのスコアは負(距離ベース)
  });

  it('あいまい一致は別名フィールドでも発火し、matchedFields/matchedAliasesに反映される', async () => {
    const node: BookmarkNode = { id: 'g2', parentId: '1', title: 'unrelated page', url: 'https://c.example.com/2' };
    const tree = [{ id: '0', title: '', children: [{ id: '1', parentId: '0', title: 'bar', children: [node] }] }];
    const aliases: [string, AliasRecord][] = [aliasRecord('https://c.example.com/2', ['documentation'])];
    const engine = await buildEngine(tree, aliases);

    // タイトルには一致しないが、別名 'documentation' への近似一致('documentaton')でのみヒットする。
    const results = engine.search({ keywords: ['documentaton'] });
    expect(results.map(r => r.node.id)).toEqual(['g2']);
    expect(results[0].matchedFields).toEqual(['alias']);
    expect(results[0].matchedAliases).toEqual(['documentation']);
  });

  it('しきい値: キーワード長4以下は距離1まで許容する(距離2は除外)', async () => {
    const node: BookmarkNode = { id: 'h1', parentId: '1', title: 'kiwi', url: 'https://d.example.com/1' };
    const tree = [{ id: '0', title: '', children: [{ id: '1', parentId: '0', title: 'bar', children: [node] }] }];
    const engine = await buildEngine(tree);

    // 'kiwj': 'kiwi' との1文字違い(距離1) → しきい値1(4文字以下)以内でヒット
    expect(engine.search({ keywords: ['kiwj'] }).map(r => r.node.id)).toEqual(['h1']);
    // 'kxwj': 'kiwi' との2文字違い(距離2) → しきい値1を超えるためヒットしない
    expect(engine.search({ keywords: ['kxwj'] })).toEqual([]);
  });

  it('しきい値: キーワード長5以上は距離2まで許容する(距離3は除外)', async () => {
    const node: BookmarkNode = { id: 'h2', parentId: '1', title: 'planet', url: 'https://d.example.com/2' };
    const tree = [{ id: '0', title: '', children: [{ id: '1', parentId: '0', title: 'bar', children: [node] }] }];
    const engine = await buildEngine(tree);

    // 'plxmet': 'planet' との2文字違い(距離2) → しきい値2(5文字以上)以内でヒット
    expect(engine.search({ keywords: ['plxmet'] }).map(r => r.node.id)).toEqual(['h2']);
    // 'plxmot': 'planet' との3文字違い(距離3) → しきい値2を超えるためヒットしない
    expect(engine.search({ keywords: ['plxmot'] })).toEqual([]);
  });
});

describe('SearchEngine — 索引(buildIndex/loadIndex)', () => {
  it('フォルダ(url を持たないノード)は検索結果に含まれない', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: [] });
    const folderIds = ['1', '2', '3', '4', '5'];
    expect(results.some(r => folderIds.includes(r.node.id))).toBe(false);
  });

  it('別名が urlHash で正しく紐付けられる', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: [] });
    const githubResult = results.find(r => r.node.id === '10');
    expect(githubResult?.aliases).toEqual(['ぎっと', 'git']);
  });

  it('不正なURLのブックマークがあっても索引構築が失敗しない', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const results = engine.search({ keywords: [] });
    const invalidResult = results.find(r => r.node.id === '15');
    expect(invalidResult).toBeDefined();
    expect(invalidResult?.aliases).toEqual([]);
  });
});

describe('SearchEngine — updateAliases(別名編集の索引即時反映)', () => {
  it('別名を差し替えると、旧別名で不一致・新別名で一致になる', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    // 反映前: 旧別名 'ぎっと' で GitHub がヒット。
    expect(engine.search({ keywords: ['ぎっと'] }).map(r => r.node.id)).toEqual(['10']);

    engine.updateAliases('https://github.com', ['ハブ']);

    // 旧別名では一致しなくなる（フォールバックも含めて 0 件）。
    expect(engine.search({ keywords: ['ぎっと'] })).toEqual([]);
    // 新別名で一致し、matchedAliases/aliases も更新される。
    const results = engine.search({ keywords: ['ハブ'] });
    expect(results.map(r => r.node.id)).toEqual(['10']);
    expect(results[0].matchedAliases).toEqual(['ハブ']);
    expect(results[0].aliases).toEqual(['ハブ']);
  });

  it('別名を空配列にすると別名照合から外れる', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    engine.updateAliases('https://github.com', []);
    // 'ぎっと' は別名にのみ存在した語（タイトル/フォルダには無い）。削除で照合対象から外れる。
    expect(engine.search({ keywords: ['ぎっと'] })).toEqual([]);
    const browse = engine.search({ keywords: [] });
    expect(browse.find(r => r.node.id === '10')?.aliases).toEqual([]);
  });

  it('生 URL が違っても正規化ハッシュが同一なら対象になる', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    // 末尾スラッシュ等の差異は normalizeUrl/hashUrl で吸収され、同一エントリに反映される。
    engine.updateAliases('https://github.com/', ['ぎっとはぶ']);
    expect(engine.search({ keywords: ['ぎっとはぶ'] }).map(r => r.node.id)).toEqual(['10']);
  });

  it('不正な URL を渡しても索引を壊さず何も変更しない', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    engine.updateAliases('not-a-valid-url', ['x']);
    // 既存の別名紐付けは維持される。
    expect(engine.search({ keywords: ['ぎっと'] }).map(r => r.node.id)).toEqual(['10']);
  });
});

describe('SearchEngine — updateNode(リネーム/URL編集の索引即時反映・U10)', () => {
  it('タイトル変更で新タイトルにヒットし旧タイトルではヒットしなくなる', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    expect(engine.search({ keywords: ['github'] }).map(r => r.node.id)).toEqual(['10']);

    engine.updateNode('10', { title: 'ハブサイト' });

    expect(engine.search({ keywords: ['github'] })).toEqual([]);
    const results = engine.search({ keywords: ['ハブサイト'] });
    expect(results.map(r => r.node.id)).toEqual(['10']);
    expect(results[0].node.title).toBe('ハブサイト');
  });

  it('URL変更が索引へ反映される', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    engine.updateNode('10', { url: 'https://renamed.example.com' });
    const results = engine.search({ keywords: [] });
    expect(results.find(r => r.node.id === '10')?.node.url).toBe('https://renamed.example.com');
  });

  it('URL変更で別名は引き継がれない(URLハッシュ紐付けのため)', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    engine.updateNode('10', { url: 'https://renamed.example.com' });
    const results = engine.search({ keywords: [] });
    expect(results.find(r => r.node.id === '10')?.aliases).toEqual([]);
  });

  it('存在しないIDを指定しても索引を壊さず既存エントリは無傷', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    engine.updateNode('does-not-exist', { title: 'x' });
    expect(engine.search({ keywords: ['github'] }).map(r => r.node.id)).toEqual(['10']);
  });
});

describe('SearchEngine — moveNode(フォルダ移動の索引即時反映・U12)', () => {
  it('移動先のフォルダパスが表示に反映される', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    // GitHub(id:10) は「ブックマーク バー」直下 → 「ブックマーク バー > 料理」へ移動。
    expect(engine.search({ keywords: ['github'] })[0].folderPath).toEqual(['ブックマーク バー']);

    engine.moveNode('10', '4', ['ブックマーク バー', '料理']);

    expect(engine.search({ keywords: ['github'] })[0].folderPath).toEqual(['ブックマーク バー', '料理']);
  });

  it('移動後はスコープ判定が新しい親フォルダで行われる', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    // 移動前: 料理(id:4)直下スコープには GitHub は含まれない。
    expect(engine.search({ keywords: [], folderScope: { folderId: '4' } }).some(r => r.node.id === '10')).toBe(false);

    engine.moveNode('10', '4', ['ブックマーク バー', '料理']);

    // 移動後: 料理(id:4)直下スコープに現れ、元の親(id:1)直下からは外れる。
    expect(engine.search({ keywords: [], folderScope: { folderId: '4' } }).some(r => r.node.id === '10')).toBe(true);
    expect(engine.search({ keywords: [], folderScope: { folderId: '1' } }).some(r => r.node.id === '10')).toBe(false);
  });

  it('移動しても別名は引き継がれる(URLハッシュ紐付けのため不変)', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    engine.moveNode('10', '4', ['ブックマーク バー', '料理']);
    expect(engine.search({ keywords: ['ぎっと'] }).map(r => r.node.id)).toEqual(['10']);
  });

  it('移動後は新しいフォルダ名でも照合できる(nFolders が更新される)', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    // 移動前: 「料理」フォルダ名では GitHub はヒットしない。
    expect(engine.search({ keywords: ['料理'] }).some(r => r.node.id === '10')).toBe(false);

    engine.moveNode('10', '4', ['ブックマーク バー', '料理']);

    // 移動後: フォルダ名「料理」で GitHub がヒットする（nFolders が更新されている）。
    expect(engine.search({ keywords: ['料理'] }).some(r => r.node.id === '10')).toBe(true);
  });

  it('存在しないIDを指定しても索引を壊さず既存エントリは無傷', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    engine.moveNode('does-not-exist', '4', ['ブックマーク バー', '料理']);
    expect(engine.search({ keywords: ['github'] })[0].folderPath).toEqual(['ブックマーク バー']);
  });
});

describe('SearchEngine — removeNode(削除の索引即時反映・U10)', () => {
  it('対象が検索結果・ブラウズ結果の両方から消える', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    engine.removeNode('10');
    expect(engine.search({ keywords: ['github'] })).toEqual([]);
    expect(engine.search({ keywords: [] }).some(r => r.node.id === '10')).toBe(false);
  });

  it('存在しないIDを指定しても索引が変化しない', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const before = engine.search({ keywords: [] }).length;
    engine.removeNode('does-not-exist');
    expect(engine.search({ keywords: [] })).toHaveLength(before);
  });
});

describe('SearchEngine — addNode(削除アンドゥ・現在ページ登録の索引即時反映・U10)', () => {
  it('追加したエントリが検索・ブラウズ結果に現れ、別名でもヒットする', async () => {
    const engine = await buildEngine(mainTree, mainAliases);
    const node: BookmarkNode = { id: '99', parentId: '1', title: 'New Bookmark', url: 'https://new.example.com' };

    engine.addNode(node, ['ブックマーク バー'], ['しんき']);

    const browse = engine.search({ keywords: [] });
    expect(browse.some(r => r.node.id === '99')).toBe(true);

    const byAlias = engine.search({ keywords: ['しんき'] });
    expect(byAlias.map(r => r.node.id)).toEqual(['99']);
    expect(byAlias[0].matchedAliases).toEqual(['しんき']);
  });
});
