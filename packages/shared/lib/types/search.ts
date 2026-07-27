import type { BookmarkNode } from '@extension/storage';

/** キーワードが一致したフィールド種別。 */
export type MatchedField = 'title' | 'folder' | 'alias';

/**
 * 検索クエリ。SearchEngine（U6）の `search` の入力。
 */
export interface SearchQuery {
  /** スペース区切りの AND 語（呼び出し側で分割済みの配列として渡す）。 */
  keywords: string[];
  /**
   * フォルダスコープ。照合対象ではなく範囲フィルタとして適用する。
   * 未指定（`undefined`）は「すべて」＝全ブックマークが対象。指定時は当該フォルダの直下のみが対象。
   */
  folderScope?: FolderScope;
}

/**
 * 検索結果の 1 項目。SearchEngine（U6）が返す値型。
 */
export interface SearchResultItem {
  /**
   * ヒットしたブックマーク。フィールド名は functional-design の `SearchResultItem.node`
   * に合わせる（U6 SearchEngine が同ドキュメントを参照して拡張するため）。
   */
  node: BookmarkNode;
  /** 上位→末端のフォルダ名（表示用）。 */
  folderPath: string[];
  /** このブックマークに紐づく別名（原文）。 */
  aliases: string[];
  /** マッチした別名。表示で先頭にハイライトする（省略対象から除外）。 */
  matchedAliases: string[];
  /** キーワードが一致したフィールドの集合。 */
  matchedFields: MatchedField[];
  /** 関連度スコア。降順ソートに用いる（同点はタイトル昇順で安定ソート）。 */
  score: number;
}

/**
 * フォルダスコープの範囲指定。照合対象ではなく範囲フィルタとして適用する。
 * 指定時は常に当該フォルダの直下のみが対象（サブフォルダは含めない）。
 */
export interface FolderScope {
  /** スコープ対象フォルダの ID（ID で保持する。フォルダ名に "/" を含んでも壊れない）。 */
  folderId: string;
}
