import type { BookmarkNode } from '@extension/storage';

/**
 * 検索結果の 1 項目。SearchEngine（U6）が返す値型。
 * 詳細な内部型（マッチ位置・フィールド別スコア等）は U6 で拡張する前提の最小定義。
 */
export interface SearchResultItem {
  /**
   * ヒットしたブックマーク。フィールド名は functional-design の `SearchResultItem.node`
   * に合わせる（U6 SearchEngine が同ドキュメントを参照して拡張するため）。
   */
  node: BookmarkNode;
  /** マッチした別名。表示で先頭にハイライトする（省略対象から除外）。 */
  matchedAliases: string[];
  /** 関連度スコア。降順ソートに用いる（同点はタイトル昇順で安定ソート）。 */
  score: number;
}

/**
 * フォルダ絞り込み（チップ方式）の範囲指定。照合対象ではなく範囲フィルタとして適用する。
 */
export interface FolderScope {
  /** 絞り込み対象フォルダの ID（ID で保持する）。 */
  folderId: string;
  /** サブフォルダを含めるか（直下のみに絞るトグル）。 */
  includeSubfolders: boolean;
}
