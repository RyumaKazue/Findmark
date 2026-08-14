/**
 * 右ペイン上部のメタ行文言を組み立てる純粋ロジック（U11）。
 *
 * design 1b/2a のメタ行（height 34）に対応。React・chrome API に非依存の純粋関数。
 * スコープ「すべて」かつクエリなし（= design 1a のブラウズ）ではメタ行を出さないため `null` を返す。
 *
 * U18: 文言そのものではなく**メッセージキーと置換値**を返す（翻訳は UI 層が行う）。スコープ名の
 * 「すべて」も呼び出し側が翻訳済みの文字列として渡す（このモジュールはロケールを知らない）。
 */

import { formatPath } from './folderTreeModel.js';
import type { LocalizedMessage } from '../lib/message.js';

interface ResultMetaInput {
  /** 圧縮済みのスコープパス（表示用に結合前の配列）。null = 「すべて」。 */
  scopePath: string[] | null;
  /** 翻訳済みの「すべて」ラベル（`scopePath` が null のときのスコープ名として使う）。 */
  allScopeLabel: string;
  /** trim 済みクエリ。空文字はブラウズ。 */
  query: string;
  /** 現在の結果件数。 */
  count: number;
}

/**
 * 右ペインのメタ行文言を組み立てる。`null` ならメタ行を描画しない（design 1a）。
 *
 * | 条件 | 出力（ja の場合） |
 * |---|---|
 * | query あり・scope あり | `開発 / chrome の中から「docs」— 4件` |
 * | query あり・scope なし | `すべて の中から「docs」— 4件` |
 * | query なし・scope あり | `開発 / chrome の直下 — 5件` |
 * | query なし・scope なし | `null`（メタ行なし） |
 */
const buildResultMetaLabel = (input: ResultMetaInput): LocalizedMessage | null => {
  const { scopePath, allScopeLabel, query, count } = input;
  const hasQuery = query.length > 0;
  const scopeLabel = scopePath === null ? allScopeLabel : formatPath(scopePath);

  if (hasQuery) {
    return { key: 'popupMetaScopedQuery', substitutions: [scopeLabel, query, String(count)] };
  }
  if (scopePath !== null) {
    return { key: 'popupMetaScopedBrowse', substitutions: [scopeLabel, String(count)] };
  }
  return null;
};

export { buildResultMetaLabel };
export type { ResultMetaInput };
