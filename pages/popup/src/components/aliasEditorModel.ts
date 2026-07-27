/**
 * 別名チップ編集の純粋ロジック（U9・React/DOM 非依存）。
 *
 * 入力確定（Enter/`,`/Space）・重複判定・上限検証・削除・並び替えを純粋関数として提供し、
 * `AliasEditor`（React 層）とユニットテスト（`aliasEditorModel.test.ts`）の双方から使う。
 * 既存の pure module（`folderTreeModel.ts`/`virtualization.ts`/`modeMachine.ts`）に倣い、
 * 宣言は非 export とし、ファイル末尾で export をまとめる。
 *
 * 上限（個数/文字数）はデータレイヤー `AliasStore`（U5）を単一の source of truth とし、
 * UI 側で再定義しない（ドリフト防止）。正規化は `Normalizer` を引数注入で受ける
 * （`packages/storage` への逆依存を作らないため。design.md「コンポーネント設計」参照）。
 */

import { MAX_ALIASES, MAX_ALIAS_LENGTH } from '@extension/storage';

/** 別名比較用のテキスト正規化関数（`Normalizer.normalizeText` を構造的に受ける）。 */
type NormalizeFn = (input: string) => string;

/**
 * 入力テキストのチップ確定結果（判別可能ユニオン）。
 * - `added`: 追加に成功。新しい別名配列を返す。
 * - `duplicate`: 正規化して既存チップと一致。`index` は光らせる対象の既存チップ位置。
 * - `empty`: 空白のみで確定対象なし（無視してよい）。
 * - `too-long`: 1個あたりの文字数上限超過。
 * - `at-limit`: 既に個数上限に達しており追加できない。
 */
type CommitOutcome =
  | { type: 'added'; aliases: string[] }
  | { type: 'duplicate'; index: number }
  | { type: 'empty' }
  | { type: 'too-long' }
  | { type: 'at-limit' };

/**
 * 入力テキストを別名チップとして確定する（純粋）。
 * 判定順: 空 → 文字数超過 → 正規化重複（既存チップ位置を返す）→ 個数上限 → 追加。
 * 重複を個数上限より先に判定するのは、上限到達後でも「既存と重複」を光らせて伝えるため。
 */
const commitAlias = (existing: string[], raw: string, normalize: NormalizeFn): CommitOutcome => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { type: 'empty' };
  }
  if (trimmed.length > MAX_ALIAS_LENGTH) {
    return { type: 'too-long' };
  }
  const normalized = normalize(trimmed);
  const dupIndex = existing.findIndex(a => normalize(a) === normalized);
  if (dupIndex >= 0) {
    return { type: 'duplicate', index: dupIndex };
  }
  if (existing.length >= MAX_ALIASES) {
    return { type: 'at-limit' };
  }
  return { type: 'added', aliases: [...existing, trimmed] };
};

/** 指定インデックスのチップを取り除いた新配列を返す（不変）。範囲外は元と同値の新配列。 */
const removeAt = (existing: string[], index: number): string[] => existing.filter((_, i) => i !== index);

/** 末尾のチップを取り除いた新配列を返す（不変）。空配列はそのまま新配列で返す。 */
const removeLast = (existing: string[]): string[] => existing.slice(0, existing.length - 1);

/**
 * マッチした別名を先頭へ寄せた新配列を返す（順序安定）。
 * `matched` に含まれる別名を元の相対順で先頭に、残りを元の相対順で後方に並べる。
 * design「マッチ別名は先頭ハイライトで省略対象外」の初期並びに使う。
 */
const orderMatchedFirst = (aliases: string[], matched: string[]): string[] => {
  const matchedSet = new Set(matched);
  const head = aliases.filter(a => matchedSet.has(a));
  const tail = aliases.filter(a => !matchedSet.has(a));
  return [...head, ...tail];
};

export { MAX_ALIASES, MAX_ALIAS_LENGTH, commitAlias, removeAt, removeLast, orderMatchedFirst };
export type { NormalizeFn, CommitOutcome };
