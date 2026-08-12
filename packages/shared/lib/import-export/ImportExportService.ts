import { parseHtmlFile, serializeHtmlFile } from './htmlFormat.js';
import { parseJsonFile, serializeJsonFile } from './jsonFormat.js';
import type { ExportBookmark, ImportBookmark } from './jsonFormat.js';
import type { AliasRecord, BookmarkNode } from '@extension/storage';

/**
 * `ImportExportService` が URL 紐付け・比較に必要とする正規化機能の最小契約。
 * `SearchEngine`/`AliasStore` と同じ DI 方針: 実体（`Normalizer`）は呼び出し側が注入する。
 */
interface ImportNormalizer {
  hashUrl(url: string): string;
}

/** インポート/エクスポートに必要な `BookmarkService` の最小契約（構造的に満たす）。 */
interface BookmarkOps {
  getTree(): Promise<BookmarkNode[]>;
  findByUrl(url: string): Promise<BookmarkNode | null>;
  getFolderPath(id: string): Promise<string[]>;
  ensureFolderPath(path: string[]): Promise<string>;
  create(data: { url?: string; title: string; parentId: string }): Promise<BookmarkNode>;
  rename(id: string, title: string): Promise<void>;
  move(id: string, parentId: string): Promise<void>;
}

/** インポート/エクスポートに必要な `AliasStore` の最小契約（構造的に満たす）。 */
interface AliasOps {
  getAll(): Promise<Map<string, AliasRecord>>;
  upsert(url: string, aliases: string[]): Promise<void>;
  merge(url: string, incoming: string[]): Promise<AliasRecord>;
}

/** 独自JSONインポートにおけるタイトル/フォルダ相違（真の競合）の解決方法。 */
type ConflictResolution = 'skip' | 'overwrite' | 'keepBoth';

/**
 * タイトル/フォルダ相違時の解決をユーザーに問う（UC-4）。実際のUI操作を待つため非同期。
 * `applyToAll: true` を返すと、`importJson` は以降の同種競合（真の競合）すべてに同じ `resolution` を
 * 適用し、再度 `resolve` を呼ばない（`docs/functional-design.md` の実装状況注記を参照）。
 */
interface ConflictResolver {
  resolve(
    existing: BookmarkNode,
    existingFolderPath: string[],
    incoming: ImportBookmark,
  ): Promise<{ resolution: ConflictResolution; applyToAll: boolean }>;
}

/** インポート結果のサマリ（functional-design 準拠）。 */
interface ImportReport {
  /** 入力件数。 */
  total: number;
  /** 新規作成した件数。 */
  created: number;
  /** 別名をマージした件数。 */
  aliasMerged: number;
  /** スキップした件数（真の競合で skip・または完全一致で何もしなかった件）。 */
  skipped: number;
  /** 上書きした件数。 */
  overwritten: number;
  /** 両方残した件数。 */
  keptBoth: number;
  /** 失敗した項目（1件の失敗は他の件の処理を止めない）。 */
  errors: { url: string; reason: string }[];
}

/** 空の `ImportReport` を生成する。 */
const emptyReport = (total: number): ImportReport => ({
  total,
  created: 0,
  aliasMerged: 0,
  skipped: 0,
  overwritten: 0,
  keptBoth: 0,
  errors: [],
});

/** 2つのフォルダパスが同一か（配列の要素ごと比較）。 */
const samePath = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * ブックマーク資産のインポート/エクスポートを担うオーケストレーション（U15・PRD 機能11）。
 *
 * chrome API・React・DOM に依存しない純粋なクラスとして単体テスト可能に保つ（architecture.md のレイヤー
 * 依存 UI→サービス→データ）。`packages/shared` は DOM API 依存禁止のため、`Blob`/`File` は扱わない。
 * ファイル読み込み・ダウンロードトリガーは呼び出し側（`pages/options`）が担う（`docs/functional-design.md`
 * の実装状況注記を参照）。
 */
class ImportExportService {
  constructor(
    private readonly normalizer: ImportNormalizer,
    private readonly bookmarks: BookmarkOps,
    private readonly aliases: AliasOps,
  ) {}

  /** 独自JSON文字列を生成する（別名を含む）。 */
  async exportJson(): Promise<string> {
    const [tree, aliasMap] = await Promise.all([this.bookmarks.getTree(), this.aliases.getAll()]);
    const entries: ExportBookmark[] = [];

    const walk = (nodes: BookmarkNode[], folderPath: string[]): void => {
      for (const node of nodes) {
        if (node.url !== undefined) {
          entries.push({
            url: node.url,
            title: node.title,
            folderPath,
            aliases: this.lookupAliases(node.url, aliasMap),
            addedAt: node.dateAdded,
          });
          continue;
        }
        if (!node.children) {
          continue;
        }
        // 真のルート（parentId 無し）は自身のタイトルをパスに積まない（BookmarkService.getFolderPath と同じ意味論）。
        const isTrueRoot = node.parentId === undefined;
        walk(node.children, isTrueRoot ? folderPath : [...folderPath, node.title]);
      }
    };
    walk(tree, []);

    return serializeJsonFile(entries);
  }

  /** 標準HTML(Netscape Bookmark File)文字列を生成する（別名は含まない）。 */
  async exportHtml(): Promise<string> {
    const tree = await this.bookmarks.getTree();
    return serializeHtmlFile(tree);
  }

  /**
   * 標準HTMLをインポートする。新規作成のみ（重複解決なし。PRD 機能11「新規作成のみのシンプル動作」）。
   * 別名は常に空のため `AliasStore` を触らない。
   */
  async importHtml(rawText: string): Promise<ImportReport> {
    const items = parseHtmlFile(rawText);
    const report = emptyReport(items.length);

    for (const item of items) {
      try {
        const parentId = await this.bookmarks.ensureFolderPath(item.folderPath);
        await this.bookmarks.create({ url: item.url, title: item.title, parentId });
        report.created++;
      } catch (e) {
        report.errors.push({ url: item.url, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return report;
  }

  /**
   * 独自JSONをインポートする（UC-4: URLで既存検索 → 3系統に分岐）。
   * パース失敗（`format`/`version` 不正）はここで throw され、`ImportReport` を返さない
   * （functional-design「パース失敗は中断・部分適用しない」）。1件ごとの失敗（chrome API 例外等）は
   * `report.errors` に積んで次の件へ継続する（全体は中断しない）。
   */
  async importJson(rawText: string, resolver: ConflictResolver): Promise<ImportReport> {
    const items = parseJsonFile(rawText); // 不正なら throw（呼び出し側が中断として扱う）
    const report = emptyReport(items.length);
    let remembered: ConflictResolution | null = null;

    for (const item of items) {
      try {
        await this.importOne(item, resolver, report, remembered, next => {
          remembered = next;
        });
      } catch (e) {
        report.errors.push({ url: item.url, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return report;
  }

  /** `importJson` の1件分の処理（UC-4 の分岐本体）。 */
  private async importOne(
    item: ImportBookmark,
    resolver: ConflictResolver,
    report: ImportReport,
    remembered: ConflictResolution | null,
    remember: (resolution: ConflictResolution) => void,
  ): Promise<void> {
    const existing = await this.bookmarks.findByUrl(item.url);

    if (!existing) {
      const parentId = await this.bookmarks.ensureFolderPath(item.folderPath);
      const created = await this.bookmarks.create({ url: item.url, title: item.title, parentId });
      // ブックマーク自体の作成はここで確定済み。以降の別名保存が失敗しても created の計上は取り消さない。
      report.created++;
      await this.applyAliasesSafely(created.url ?? item.url, item.aliases, 'upsert', report);
      return;
    }

    const existingFolderPath = await this.bookmarks.getFolderPath(existing.id);
    const isIdentical = existing.title === item.title && samePath(existingFolderPath, item.folderPath);

    if (isIdentical) {
      if (item.aliases.length > 0) {
        await this.aliases.merge(item.url, item.aliases);
        report.aliasMerged++;
      } else {
        report.skipped++;
      }
      return;
    }

    // タイトル/フォルダ相違＝真の競合。一括適用が記憶されていれば resolver へは問い合わせない。
    let resolution: ConflictResolution;
    if (remembered !== null) {
      resolution = remembered;
    } else {
      const decided = await resolver.resolve(existing, existingFolderPath, item);
      resolution = decided.resolution;
      if (decided.applyToAll) {
        remember(decided.resolution);
      }
    }

    if (resolution === 'skip') {
      report.skipped++;
      return;
    }
    if (resolution === 'overwrite') {
      const parentId = await this.bookmarks.ensureFolderPath(item.folderPath);
      await this.bookmarks.rename(existing.id, item.title);
      await this.bookmarks.move(existing.id, parentId);
      // タイトル/フォルダの上書きはここで確定済み。以降の別名マージが失敗しても overwritten の計上は取り消さない。
      report.overwritten++;
      await this.applyAliasesSafely(item.url, item.aliases, 'merge', report);
      return;
    }
    // keepBoth: 既存はそのまま残し、別ノードとして追加作成する。
    const parentId = await this.bookmarks.ensureFolderPath(item.folderPath);
    const created = await this.bookmarks.create({ url: item.url, title: item.title, parentId });
    report.keptBoth++;
    await this.applyAliasesSafely(created.url ?? item.url, item.aliases, 'upsert', report);
  }

  /**
   * 別名の保存（upsert/merge）を行い、失敗しても呼び出し元へ伝播させない（実装検証で「ブックマーク側の
   * 変更（create/rename+move）成功後に別名保存だけが失敗すると、ブックマーク側の成功ごと `errors` に
   * 埋もれて `ImportReport` の計上と実際の変更内容が食い違う」不整合が指摘されたための是正）。
   * ブックマーク側のカウント（created/overwritten/keptBoth）は呼び出し元で既に確定させたうえで呼ぶこと。
   * 別名の失敗だけを `report.errors` へ個別に積む（`aliases.length === 0` なら何もしない）。
   */
  private async applyAliasesSafely(
    url: string,
    aliases: string[],
    op: 'upsert' | 'merge',
    report: ImportReport,
  ): Promise<void> {
    if (aliases.length === 0) {
      return;
    }
    try {
      if (op === 'upsert') {
        await this.aliases.upsert(url, aliases);
      } else {
        await this.aliases.merge(url, aliases);
      }
    } catch (e) {
      report.errors.push({ url, reason: `別名の保存に失敗しました: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /** `url` に対応する別名を索引から引く。不正URLは空配列で握り潰す（`SearchEngine.lookupAliases` と同方針）。 */
  private lookupAliases(url: string, aliasMap: Map<string, AliasRecord>): string[] {
    try {
      return aliasMap.get(this.normalizer.hashUrl(url))?.aliases ?? [];
    } catch {
      return [];
    }
  }
}

export { ImportExportService, emptyReport };
export type { ImportNormalizer, BookmarkOps, AliasOps, ConflictResolution, ConflictResolver, ImportReport };
