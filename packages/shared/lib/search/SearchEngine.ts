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
  /** 上位→末端の祖先フォルダ ID(folderScope の範囲判定用)。 */
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

  constructor(private readonly normalizer: SearchNormalizer) {}

  /** `bookmarkService`/`aliasStore` からデータを取得し、索引を再構築する。 */
  async loadIndex(bookmarkService: BookmarkTreeSource, aliasStore: AliasSource): Promise<void> {
    const [tree, aliasMap] = await Promise.all([bookmarkService.getTree(), aliasStore.getAll()]);
    this.entries = this.buildIndex(tree, aliasMap);
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
          walk(node.children, [...folderPath, node.title], [...folderIdPath, node.id]);
        }
      }
    };

    walk(tree, [], []);
    return entries;
  }

  /**
   * 正規化 AND 部分一致で検索する(同期)。キーワードが空ならフォルダ絞り込みのみを適用した
   * 全件をタイトル昇順で返す(ブラウズ)。通常検索が 0 件のときのみあいまい一致にフォールバックする。
   */
  search(query: SearchQuery): SearchResultItem[] {
    const keywords = query.keywords.map(k => this.normalizer.normalizeText(k)).filter(k => k.length > 0);
    const scoped = this.entries.filter(entry => this.inScope(entry, query.folderScope));

    if (keywords.length === 0) {
      return this.sortResults(scoped.map(entry => this.toBrowseItem(entry)));
    }

    const matched = this.matchAll(scoped, keywords);
    if (matched.length > 0) {
      return this.sortResults(matched.map(acc => this.toResultItem(acc)));
    }

    const fallback = this.fuzzyFallback(scoped, keywords);
    return this.sortResults(fallback.map(acc => this.toResultItem(acc)));
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

  private inScope(entry: SearchEntry, scope: FolderScope | undefined): boolean {
    if (!scope) {
      return true;
    }
    if (scope.includeSubfolders) {
      return entry.folderIdPath.includes(scope.folderId);
    }
    return entry.node.parentId === scope.folderId;
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
}

export type { SearchNormalizer, BookmarkTreeSource, AliasSource };
