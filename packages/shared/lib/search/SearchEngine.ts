import { approxSubstringDistance, fuzzyThreshold } from './fuzzy.js';
import type { FolderScope, MatchedField, SearchQuery, SearchResultItem } from '../types/search.js';
import type { AliasRecord, BookmarkNode } from '@extension/storage';

/** タイトル=10 / 別名=8 / フォルダ名=4（functional-design「検索スコアリングとマッチング」）。 */
const FIELD_BASE_SCORE = { title: 10, alias: 8, folder: 4 } as const;
/** 完全一致=+5 / 前方一致=+3 / 部分一致=+0。 */
const POSITION_BONUS = { exact: 5, prefix: 3, partial: 0 } as const;

/**
 * `SearchEngine` が別名紐付け・比較に必要とする正規化機能の最小契約。
 * `AliasStore` の `AliasNormalizer` と同じ思想: 実体（`Normalizer`）は呼び出し側が注入する。
 */
interface SearchNormalizer {
  hashUrl(url: string): string;
  normalizeText(input: string): string;
}

/** 索引構築に必要なブックマークツリー取得の最小契約(`BookmarkService` を構造的に満たす)。 */
interface BookmarkTreeSource {
  getTree(): Promise<BookmarkNode[]>;
}

/** 索引構築に必要な別名全件取得の最小契約(`AliasStore` を構造的に満たす)。 */
interface AliasSource {
  getAll(): Promise<Map<string, AliasRecord>>;
}

/** 索引の 1 エントリ(url を持つブックマーク 1 件に対応)。 */
interface SearchEntry {
  node: BookmarkNode;
  /** 上位→末端のフォルダ名(表示用。真のルートは含まない)。 */
  folderPath: string[];
  /**
   * 上位→末端のフォルダ **ID**(スコープ判定用。`folderPath` と同じ長さ・同じ並び。真のルートは含まない)。
   *
   * 名前ではなく ID で持つのは、同名フォルダが別階層にあるときに取り違えないため
   * (`開発/資料` と `記事/資料` を区別する)。「内部的にフォルダIDを保持し、フォルダ名に `/` が
   * 含まれても壊れない」という PRD 機能5 の方針とも一致する(`folder-scope-descendants`)。
   */
  folderIdPath: string[];
  /** 別名(原文)。 */
  aliases: string[];
  /** 正規化済みタイトル。 */
  nTitle: string;
  /** 正規化済みフォルダ名(folderPath と同順)。 */
  nFolders: string[];
  /** 正規化済み別名(aliases と同順)。 */
  nAliases: string[];
}

/** 検索マッチの中間集計(スコア・マッチ理由を蓄積してから `SearchResultItem` へ変換する)。 */
interface MatchAccumulator {
  entry: SearchEntry;
  score: number;
  matchedFields: Set<MatchedField>;
  matchedAliases: Set<string>;
}

/**
 * ブックマーク全件と別名を対象に、正規化 AND 部分一致で絞り込み、マッチ理由を付与して返す検索エンジン。
 *
 * `search()` は同期関数として提供する(1,000 件で 1 文字あたり 100ms 以内という性能要件のため、
 * 索引構築のみを非同期の外縁とし、検索そのものは事前構築したインメモリ索引への同期処理にする)。
 * chrome API・React・DOM に依存しない純粋ロジックとして単体テスト可能に保つ
 * (architecture.md のレイヤー依存 UI→サービス→データ)。
 */
export class SearchEngine {
  private entries: SearchEntry[] = [];

  /**
   * フォルダ ID → そのフォルダまでの ID パス(自身を含む)の索引(`folder-scope-descendants`)。
   *
   * `moveNode`/`addNode` は呼び出し側からフォルダ**名**のパスしか受け取らないため、移動/追加した
   * エントリの `folderIdPath` をここから引く。中身が空のフォルダも含むため、空フォルダへの移動でも解決できる。
   */
  private folderIdPaths = new Map<string, string[]>();

  constructor(private readonly normalizer: SearchNormalizer) {}

  /** `bookmarkService`/`aliasStore` からデータを取得し、索引を再構築する。 */
  async loadIndex(bookmarkService: BookmarkTreeSource, aliasStore: AliasSource): Promise<void> {
    const [tree, aliasMap] = await Promise.all([bookmarkService.getTree(), aliasStore.getAll()]);
    this.entries = this.buildIndex(tree, aliasMap);
    this.folderIdPaths = this.buildFolderIdPaths(tree);
  }

  /**
   * ブックマークツリーと別名マップから索引エントリ配列を構築する(純粋。同じ入力なら同じ出力)。
   * フォルダ(url を持たないノード)は結果に含めない。真のルート(`parentId` 無し)はパスに含めない。
   */
  buildIndex(tree: BookmarkNode[], aliasMap: Map<string, AliasRecord>): SearchEntry[] {
    const entries: SearchEntry[] = [];

    const walk = (nodes: BookmarkNode[], folderPath: string[], folderIdPath: string[]): void => {
      for (const node of nodes) {
        if (node.url !== undefined) {
          const aliases = this.lookupAliases(node.url, aliasMap);
          entries.push({
            node,
            folderPath,
            folderIdPath,
            aliases,
            nTitle: this.normalizer.normalizeText(node.title),
            nFolders: folderPath.map(f => this.normalizer.normalizeText(f)),
            nAliases: aliases.map(a => this.normalizer.normalizeText(a)),
          });
          continue;
        }
        if (!node.children) {
          continue;
        }
        // 真のルート(parentId 無し)は自身のタイトルをパスに積まない(BookmarkService.getFolderPath と同じ意味論)。
        const isTrueRoot = node.parentId === undefined;
        if (isTrueRoot) {
          walk(node.children, folderPath, folderIdPath);
        } else {
          // 名前と ID を同じ場所で積む(走査を増やさない。両者の長さ・並びは常に一致する)。
          walk(node.children, [...folderPath, node.title], [...folderIdPath, node.id]);
        }
      }
    };

    walk(tree, [], []);
    return entries;
  }

  /**
   * フォルダ ID → ID パス(自身を含む・真のルートは含まない)の対応表を作る(純粋)。
   * `buildIndex` を純粋なまま保つため別の走査にしている(木の走査は O(n) で、索引構築1回あたりの
   * コストとしては無視できる)。
   */
  private buildFolderIdPaths(tree: BookmarkNode[]): Map<string, string[]> {
    const paths = new Map<string, string[]>();
    const walk = (nodes: BookmarkNode[], folderIdPath: string[]): void => {
      for (const node of nodes) {
        if (node.url !== undefined || !node.children) {
          continue;
        }
        // 真のルート(parentId 無し)は自身をパスに積まない(`buildIndex` と同じ意味論)。
        if (node.parentId === undefined) {
          walk(node.children, folderIdPath);
          continue;
        }
        const next = [...folderIdPath, node.id];
        paths.set(node.id, next);
        walk(node.children, next);
      }
    };
    walk(tree, []);
    return paths;
  }

  /**
   * フォルダ ID からその ID パス(自身を含む)を引く。索引構築後に新設されたフォルダ(ゴミ箱からの復元や
   * `ensureFolderPath` による自動作成)は対応表に無いため、**直接の親だけを持つパス**にフォールバックする。
   * この場合、そのフォルダ自身をスコープにした表示は正しく、より上位のフォルダをスコープにしたときだけ
   * 次の索引再構築(ポップアップの開き直し・`reloadIndex`)まで漏れる。データは壊れない。
   */
  private resolveFolderIdPath(folderId: string): string[] {
    return this.folderIdPaths.get(folderId) ?? [folderId];
  }

  /**
   * 正規化 AND 部分一致で検索する(同期)。キーワードが空ならフォルダ絞り込みのみを適用した
   * 全件をタイトル昇順で返す(ブラウズ)。通常検索が 0 件のときのみあいまい一致にフォールバックする。
   */
  search(query: SearchQuery): SearchResultItem[] {
    const keywords = query.keywords.map(k => this.normalizer.normalizeText(k)).filter(k => k.length > 0);
    const scoped = this.entries.filter(entry => this.inScope(entry, query.folderScope));

    if (keywords.length === 0) {
      return this.sortBrowseResults(
        scoped.map(entry => this.toBrowseItem(entry)),
        query.folderScope?.folderId,
      );
    }

    const matched = this.matchAll(scoped, keywords);
    if (matched.length > 0) {
      return this.sortResults(matched.map(acc => this.toResultItem(acc)));
    }

    const fallback = this.fuzzyFallback(scoped, keywords);
    return this.sortResults(fallback.map(acc => this.toResultItem(acc)));
  }

  /**
   * 索引上で、指定 URL と同一の正規化ハッシュ（`hashUrl`）を持つエントリの別名を差し替える（同期）。
   * 別名編集（U9）の結果を索引へ再構築なしで即時反映するために使う。別名は URL 正規化ハッシュで
   * 紐付くため、生 URL 一致ではなく `hashUrl` 一致で対象を選ぶ（同一正規化 URL の複数エントリにも適用）。
   * 不正な URL（`hashUrl` が throw）は握り潰してスキップし、索引全体を壊さない。
   */
  updateAliases(url: string, aliases: string[]): void {
    let targetHash: string;
    try {
      targetHash = this.normalizer.hashUrl(url);
    } catch (e) {
      console.warn('[SearchEngine] 別名の索引反映に失敗しました（不正なURL）:', url, e);
      return;
    }
    const nAliases = aliases.map(a => this.normalizer.normalizeText(a));
    for (const entry of this.entries) {
      if (entry.node.url === undefined) {
        continue;
      }
      let entryHash: string;
      try {
        entryHash = this.normalizer.hashUrl(entry.node.url);
      } catch {
        continue;
      }
      if (entryHash !== targetHash) {
        continue;
      }
      entry.aliases = [...aliases];
      entry.nAliases = [...nAliases];
    }
  }

  /**
   * 索引上のエントリのタイトル/URLを部分更新する(同期・U10)。リネーム/URL編集の結果を索引の
   * 全再構築なしに反映するために使う。`id` が一致するエントリが無ければ何もしない。
   *
   * URL を変更した場合、別名は引き継がない(別名は URL 正規化ハッシュで紐付くため、URL が変われば
   * 別レコードになる。`updateAliases` の「hashUrl 一致で適用」という既存の意味論と整合させる)。
   */
  updateNode(id: string, patch: { title?: string; url?: string }): void {
    const entry = this.entries.find(e => e.node.id === id);
    if (!entry) {
      return;
    }
    if (patch.title !== undefined) {
      entry.node = { ...entry.node, title: patch.title };
      entry.nTitle = this.normalizer.normalizeText(patch.title);
    }
    if (patch.url !== undefined) {
      entry.node = { ...entry.node, url: patch.url };
      entry.aliases = [];
      entry.nAliases = [];
    }
  }

  /**
   * 索引上のエントリの所属フォルダを更新する(同期・U12)。フォルダ移動の結果を索引の全再構築なしに
   * 反映するために使う。`id` が一致するエントリが無ければ何もしない。
   *
   * `parentId`(スコープ判定 `inScope` が参照)と `folderPath`/`nFolders`(表示・フォルダ名照合)を
   * 差し替える。別名は URL 正規化ハッシュに紐付くため移動では不変(`aliases`/`nAliases` は触らない)。
   * これにより移動後に再検索すると、フォルダパス表示が更新され、スコープ判定も新しい親で行われる
   * (移動しても結果から人為的に消さず、パス表示だけ更新する = PRD 機能7)。
   */
  moveNode(id: string, parentId: string, folderPath: string[]): void {
    const entry = this.entries.find(e => e.node.id === id);
    if (!entry) {
      return;
    }
    entry.node = { ...entry.node, parentId };
    entry.folderPath = folderPath;
    entry.nFolders = folderPath.map(f => this.normalizer.normalizeText(f));
    // スコープ判定は ID の祖先関係で行うため、移動時に ID パスも更新する(`folder-scope-descendants`)。
    // これを忘れると、移動したのに旧階層のスコープに出続ける/新階層のスコープに出ない、という乖離になる。
    entry.folderIdPath = this.resolveFolderIdPath(parentId);
  }

  /** 索引上のエントリを削除する(同期・U10)。`id` が一致するエントリが無ければ何もしない。 */
  removeNode(id: string): void {
    const index = this.entries.findIndex(e => e.node.id === id);
    if (index === -1) {
      return;
    }
    this.entries.splice(index, 1);
  }

  /**
   * 索引へエントリを追加する(同期・U10)。削除アンドゥ・現在ページ登録(U14)等、
   * chrome API 側で作成済みのノードを索引へ反映するために使う。
   */
  addNode(node: BookmarkNode, folderPath: string[], aliases: string[]): void {
    this.entries.push({
      node,
      folderPath,
      // 親を持たない(理論上のみ)場合は空パス＝どのフォルダスコープにも属さない。
      folderIdPath: node.parentId === undefined ? [] : this.resolveFolderIdPath(node.parentId),
      aliases,
      nTitle: this.normalizer.normalizeText(node.title),
      nFolders: folderPath.map(f => this.normalizer.normalizeText(f)),
      nAliases: aliases.map(a => this.normalizer.normalizeText(a)),
    });
  }

  private lookupAliases(url: string, aliasMap: Map<string, AliasRecord>): string[] {
    try {
      const hash = this.normalizer.hashUrl(url);
      return aliasMap.get(hash)?.aliases ?? [];
    } catch (e) {
      // 不正な URL のブックマーク(例: 拡張機能の内部ページ等)で索引構築全体を落とさない。
      console.warn('[SearchEngine] 別名の紐付けに失敗しました(不正なURL):', url, e);
      return [];
    }
  }

  /**
   * スコープ未指定(=「すべて」)は全件対象。指定時は**当該フォルダの配下すべて**(直下 + サブフォルダの中身)を
   * 対象とする(`folder-scope-descendants`)。
   *
   * 旧仕様は「直下のみ」だったが、フォルダを選んでも中身が見えない(実体がサブフォルダにある場合に右ペインが
   * ほぼ空になる)・左ペインの件数バッジ(配下すべてを数える)と食い違う、という問題があったため改めた。
   * 判定は**ID の祖先関係**で行う(同名フォルダの取り違えを避ける。`folderIdPath` の doc を参照)。
   */
  private inScope(entry: SearchEntry, scope: FolderScope | undefined): boolean {
    if (!scope) {
      return true;
    }
    return entry.folderIdPath.includes(scope.folderId);
  }

  /** 正規化 AND 部分一致。全キーワードが(いずれかのフィールドに)一致したエントリのみ返す。 */
  private matchAll(entries: SearchEntry[], keywords: string[]): MatchAccumulator[] {
    const results: MatchAccumulator[] = [];
    for (const entry of entries) {
      const matchedFields = new Set<MatchedField>();
      const matchedAliases = new Set<string>();
      let total = 0;
      let allKeywordsMatched = true;

      for (const keyword of keywords) {
        const titleScore = this.bestFieldScore([entry.nTitle], keyword, FIELD_BASE_SCORE.title);
        const folderScore = this.bestFieldScore(entry.nFolders, keyword, FIELD_BASE_SCORE.folder);
        const aliasScore = this.bestFieldScore(entry.nAliases, keyword, FIELD_BASE_SCORE.alias);

        const scores: number[] = [];
        if (titleScore !== null) {
          scores.push(titleScore);
          matchedFields.add('title');
        }
        if (folderScore !== null) {
          scores.push(folderScore);
          matchedFields.add('folder');
        }
        if (aliasScore !== null) {
          scores.push(aliasScore);
          matchedFields.add('alias');
          entry.nAliases.forEach((na, i) => {
            if (na.includes(keyword)) {
              matchedAliases.add(entry.aliases[i]);
            }
          });
        }

        if (scores.length === 0) {
          allKeywordsMatched = false;
          break;
        }
        total += Math.max(...scores);
      }

      if (allKeywordsMatched) {
        results.push({ entry, score: total, matchedFields, matchedAliases });
      }
    }
    return results;
  }

  /** `candidates` の中で `keyword` を部分文字列として含むものの最良スコア(基礎点+位置ボーナス)。無ければ `null`。 */
  private bestFieldScore(candidates: string[], keyword: string, baseScore: number): number | null {
    let best: number | null = null;
    for (const candidate of candidates) {
      if (!candidate.includes(keyword)) {
        continue;
      }
      const bonus =
        candidate === keyword
          ? POSITION_BONUS.exact
          : candidate.startsWith(keyword)
            ? POSITION_BONUS.prefix
            : POSITION_BONUS.partial;
      const score = baseScore + bonus;
      if (best === null || score > best) {
        best = score;
      }
    }
    return best;
  }

  /**
   * 結果 0 件時のみ呼ばれるあいまい一致。編集距離が `fuzzyThreshold(キーワード長)` 以下の
   * フィールドを一致とみなす。AND 条件は維持する(全キーワードが近似一致したエントリのみ通過)。
   */
  private fuzzyFallback(entries: SearchEntry[], keywords: string[]): MatchAccumulator[] {
    const results: MatchAccumulator[] = [];
    for (const entry of entries) {
      const matchedFields = new Set<MatchedField>();
      const matchedAliases = new Set<string>();
      let totalDistance = 0;
      let allKeywordsMatched = true;

      for (const keyword of keywords) {
        const threshold = fuzzyThreshold(keyword.length);
        const candidateDistances: number[] = [];

        const titleDistance = approxSubstringDistance(keyword, entry.nTitle);
        if (titleDistance <= threshold) {
          matchedFields.add('title');
          candidateDistances.push(titleDistance);
        }

        const folderDistances = entry.nFolders.map(f => approxSubstringDistance(keyword, f));
        if (folderDistances.some(d => d <= threshold)) {
          matchedFields.add('folder');
          candidateDistances.push(Math.min(...folderDistances));
        }

        entry.nAliases.forEach((na, i) => {
          const d = approxSubstringDistance(keyword, na);
          if (d <= threshold) {
            matchedFields.add('alias');
            matchedAliases.add(entry.aliases[i]);
            candidateDistances.push(d);
          }
        });

        if (candidateDistances.length === 0) {
          allKeywordsMatched = false;
          break;
        }
        totalDistance += Math.min(...candidateDistances);
      }

      if (allKeywordsMatched) {
        // 距離が小さいほど上位になるよう符号を反転する(通常検索のスコアと同じ「降順ソート」で扱う)。
        results.push({ entry, score: -totalDistance, matchedFields, matchedAliases });
      }
    }
    return results;
  }

  private toBrowseItem(entry: SearchEntry): SearchResultItem {
    return {
      node: entry.node,
      folderPath: entry.folderPath,
      aliases: entry.aliases,
      matchedAliases: [],
      matchedFields: [],
      score: 0,
    };
  }

  private toResultItem(acc: MatchAccumulator): SearchResultItem {
    return {
      node: acc.entry.node,
      folderPath: acc.entry.folderPath,
      aliases: acc.entry.aliases,
      matchedAliases: [...acc.matchedAliases],
      matchedFields: [...acc.matchedFields],
      score: acc.score,
    };
  }

  /** スコア降順、同点はタイトル昇順の安定ソート。 */
  private sortResults(items: SearchResultItem[]): SearchResultItem[] {
    return [...items].sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title));
  }

  /**
   * ブラウズ(キーワードなし)の並び。スコープ指定時は**直下のブックマークを先頭グループ**に置き、
   * サブフォルダ内のものを後続グループにする(`folder-scope-descendants`)。各グループ内は従来どおり
   * タイトル昇順(ブラウズはスコアが一律のため実質タイトル順)。
   *
   * - **深さは2段階**にする(「直下」と「それ以外の配下すべて」)。孫とひ孫は区別せず、同じ後続グループの中で
   *   タイトル昇順に並ぶ。階層の深さを並びへ細かく反映しても、同じフォルダの中身が離れて並ぶだけで利点が薄い。
   * - スコープ未指定(「すべて」)ではグループ分けをしない(「直下」という基準が存在しないため)。
   * - **キーワード検索ではこの関数を使わない**。検索は関連度で見つける操作であり、階層を優先すると
   *   深い階層の強い一致(別名の完全一致など)が直下の弱い一致の下に埋もれるため(`sortResults` を使う)。
   */
  private sortBrowseResults(items: SearchResultItem[], directParentId: string | undefined): SearchResultItem[] {
    if (directParentId === undefined) {
      return this.sortResults(items);
    }
    const groupOf = (item: SearchResultItem): number => (item.node.parentId === directParentId ? 0 : 1);
    return [...items].sort(
      (a, b) => groupOf(a) - groupOf(b) || b.score - a.score || a.node.title.localeCompare(b.node.title),
    );
  }
}

export type { SearchNormalizer, BookmarkTreeSource, AliasSource };
