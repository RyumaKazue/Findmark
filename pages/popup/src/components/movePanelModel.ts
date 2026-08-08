/**
 * フォルダ選択パネル（MovePanel・U12）の候補構築・絞り込みの純粋ロジック。
 *
 * 左ペインと同じ `FolderTreeNode[]`（`folderTreeModel`）を、フラットな移動先候補へ変換する。
 * React / chrome API に非依存の純粋関数群にし、`MovePanel`（UI）とユニットテスト（`movePanelModel.test.ts`）
 * から利用する。正規化（Normalizer）は呼び出し側が注入する（`SearchEngine`/`AliasStore` と同じ DI 方針）。
 *
 * 出典: PRD 機能7「Ctrl+M でフォルダ選択パネルを開き、フォルダ名の絞り込み入力 → Enter で移動できる」
 * 「現在の親フォルダはグレーアウトして無効化する」。
 */
import type { FolderTreeNode } from './folderTreeModel.js';

/** 移動先候補1件（フラット化済み）。 */
interface MoveCandidate {
  id: string;
  /** 末端フォルダ名（絞り込みの主対象）。 */
  title: string;
  /** ルート→当該フォルダのタイトル配列（表示用。結合は表示時のみ）。 */
  path: string[];
  /** 現在の親フォルダか（グレーアウト表示・確定時に弾く）。 */
  disabled: boolean;
}

/**
 * フォルダツリーを深さ優先でフラット化し、各フォルダを移動先候補にする（純粋）。
 * `currentParentId` と一致するフォルダは `disabled`（現在の場所への移動は無意味）。
 * 現在の親も候補には残す（存在を隠さず、グレーアウトで「現在の場所」を示すため）。
 */
const buildMoveCandidates = (folders: FolderTreeNode[], currentParentId: string | null): MoveCandidate[] => {
  const out: MoveCandidate[] = [];
  const walk = (nodes: FolderTreeNode[], ancestors: string[]): void => {
    for (const node of nodes) {
      const path = [...ancestors, node.title];
      out.push({ id: node.id, title: node.title, path, disabled: node.id === currentParentId });
      walk(node.children, path);
    }
  };
  walk(folders, []);
  return out;
};

/**
 * 正規化部分一致で候補を絞り込む（純粋）。空クエリ（トリム後）は全件を返す。
 * 末尾フォルダ名またはフルパス（結合文字列）のいずれかに一致すれば通す
 * （深い階層のフォルダを親の名前でも辿れるようにする）。
 */
const filterCandidates = (
  candidates: MoveCandidate[],
  query: string,
  normalize: (s: string) => string,
): MoveCandidate[] => {
  const q = normalize(query.trim());
  if (q.length === 0) {
    return candidates;
  }
  return candidates.filter(c => {
    const title = normalize(c.title);
    const full = normalize(c.path.join(' / '));
    return title.includes(q) || full.includes(q);
  });
};

/** ↑↓ の候補インデックスを範囲内へクランプする（端では留まる）。空リストは 0。 */
const clampIndex = (index: number, length: number): number => {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), length - 1);
};

export { buildMoveCandidates, filterCandidates, clampIndex };
export type { MoveCandidate };
