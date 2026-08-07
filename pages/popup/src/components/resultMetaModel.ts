/**
 * 右ペイン上部のメタ行文言を組み立てる純粋ロジック（U11）。
 *
 * design 1b/2a のメタ行（height 34）に対応。React・chrome API に非依存の純粋関数。
 * スコープ「すべて」かつクエリなし（= design 1a のブラウズ）ではメタ行を出さないため `null` を返す。
 */

import { formatPath } from './folderTreeModel.js';

interface ResultMetaInput {
  /** 圧縮済みのスコープパス（表示用に結合前の配列）。null = 「すべて」。 */
  scopePath: string[] | null;
  /** trim 済みクエリ。空文字はブラウズ。 */
  query: string;
  /** 現在の結果件数。 */
  count: number;
}

/**
 * 右ペインのメタ行文言を組み立てる。`null` ならメタ行を描画しない（design 1a）。
 *
 * | 条件 | 出力 |
 * |---|---|
 * | query あり・scope あり | `開発 / chrome の中から「docs」— 4件` |
 * | query あり・scope なし | `すべて の中から「docs」— 4件` |
 * | query なし・scope あり | `開発 / chrome の直下 — 5件` |
 * | query なし・scope なし | `null`（メタ行なし） |
 */
const buildResultMetaLabel = (input: ResultMetaInput): string | null => {
  const { scopePath, query, count } = input;
  const hasQuery = query.length > 0;
  const scopeLabel = scopePath === null ? 'すべて' : formatPath(scopePath);

  if (hasQuery) {
    return `${scopeLabel} の中から「${query}」— ${count}件`;
  }
  if (scopePath !== null) {
    return `${scopeLabel} の直下 — ${count}件`;
  }
  return null;
};

export { buildResultMetaLabel };
export type { ResultMetaInput };
