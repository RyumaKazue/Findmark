import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * 絞り込み候補リストで、選択中の要素（`[data-selected="true"]`）を可視範囲へ追従スクロールさせる。
 *
 * `MovePanel`（`Ctrl/Cmd+M` の移動先フォルダ）と `AddCurrentPanel`（`Ctrl/Cmd+D` の保存先フォルダ）は、
 * どちらも `movePanelModel`（`buildMoveCandidates` / `filterCandidates` / `clampIndex`）を共有した同じ形の
 * 候補リストを持つ。しかし**この追従処理は `MovePanel` にしか実装されておらず**、`AddCurrentPanel` では
 * `↑↓` で選択を動かしてもリストがスクロールせず、選択中の候補が可視範囲の外へ消えたままになっていた。
 * 同じ実装を2箇所に持つと「片方だけ移植し忘れる」事故が再発するため、1つのフックへ集約して両者から呼ぶ。
 *
 * `block: 'nearest'` を使うのは、**可視範囲内にあるときは何もせず、外へ出たときだけ最小限スクロールする**ため
 * （`'center'` 等では選択のたびにリストが飛び、落ち着かない動きになる）。
 *
 * 選択状態は「選択中の要素に `data-selected="true"` が付く」という DOM 契約でのみ受け取る。呼び出し側の
 * state 形（インデックス / ID など）に依存しないため、今後追加する候補リストにもそのまま適用できる。
 *
 * @param listRef スクロールコンテナ（`overflow-y-auto` を持つ要素）への ref
 * @param deps 追従を再評価すべき値（選択位置・候補配列など）。再評価のタイミングは呼び出し側の state に
 *   依存し、フック内部では決められないため、`useEffect` の依存配列をそのまま透過させる薄いラッパにしている。
 */
const useScrollSelectedIntoView = (listRef: RefObject<HTMLElement | null>, deps: readonly unknown[]): void => {
  useEffect(() => {
    // ref 未設定・選択要素なしのいずれでも、二重のオプショナルチェーンで何もせず終わる。
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    // `deps` は呼び出し側の規約（上記 JSDoc）。`listRef` は ref のため依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
};

export { useScrollSelectedIntoView };
