import {
  clear,
  deactivate,
  emptySelection,
  isSelected,
  rangeTo,
  selectAll,
  toggle,
  toggleActive,
} from './selectionModel.js';
import { useCallback, useState } from 'react';

export interface UseSelectionApi {
  /** 選択中のブックマーク ID 集合（読み取り専用）。 */
  selectedIds: ReadonlySet<string>;
  /** 選択件数（0 = 非選択・ヘッダーの一括操作バー切替の判定に使う）。 */
  count: number;
  /** 指定 id が選択中か。 */
  isSelected: (id: string) => boolean;
  /** 個別トグル（選択モード中の行クリック・通常モードの Ctrl/Cmd+クリック）。 */
  toggle: (id: string) => void;
  /** 範囲選択（Shift+クリック）。`orderedIds` は現在の表示結果の並び順。 */
  rangeTo: (id: string, orderedIds: readonly string[]) => void;
  /** 全件選択（Ctrl/Cmd+A）。 */
  selectAll: (orderedIds: readonly string[]) => void;
  /** 選択解除（選択モードは維持する。クエリ/スコープ変更時に使う）。 */
  clear: () => void;
  /** 選択モード中か（行クリックが「選ぶ」になっているか・`selection-mode`）。 */
  selectionMode: boolean;
  /** 選択モードを終了する（選択もクリアする）。Escape・[選択解除]・一括操作の完了後に使う。 */
  exitSelectionMode: () => void;
  /** ヘッダーのトグルボタン用。ON→OFF では選択もクリアする。 */
  toggleSelectionMode: () => void;
}

/**
 * 複数選択（U13）と選択モード（`selection-mode`）を React へ橋渡しするフック。
 *
 * 純粋ロジックは `selectionModel.ts` に集約し、本フックは `useState` で state を保持し操作を公開するだけの
 * 薄い層にする（`useMode`/`useUndo` と同じ設計）。選択はフォーカス・モード・スコープと直交する独立状態であり、
 * クエリ/スコープ変更時の `clear()` 呼び出しは呼び出し側（Popup）の責務とする。
 *
 * **`enterSelectionMode` を公開しない**: 選択モードへ「入る」導線はヘッダーのトグルボタンだけであり、それは
 * `toggleSelectionMode` が担う。選択操作（`toggle`/`rangeTo`/`selectAll`）経由の遷移は `selectionModel` の
 * 不変条件として自動で起きるため、呼び出し側が「入ってから選ぶ」順序を書ける余地を残さない
 * （書き忘れると「選択があるのに通常モード＝クリックでサイトが開く」という不整合になる）。
 */
export const useSelection = (): UseSelectionApi => {
  const [state, setState] = useState(emptySelection);

  const toggleId = useCallback((id: string) => setState(s => toggle(s, id)), []);
  const rangeToId = useCallback(
    (id: string, orderedIds: readonly string[]) => setState(s => rangeTo(s, id, orderedIds)),
    [],
  );
  const selectAllIds = useCallback((orderedIds: readonly string[]) => setState(() => selectAll(orderedIds)), []);
  const clearSelection = useCallback(() => setState(clear), []);
  const exitSelectionMode = useCallback(() => setState(deactivate), []);
  const toggleSelectionMode = useCallback(() => setState(toggleActive), []);
  const isIdSelected = useCallback((id: string) => isSelected(state, id), [state]);

  return {
    selectedIds: state.ids,
    count: state.ids.size,
    isSelected: isIdSelected,
    toggle: toggleId,
    rangeTo: rangeToId,
    selectAll: selectAllIds,
    clear: clearSelection,
    selectionMode: state.active,
    exitSelectionMode,
    toggleSelectionMode,
  };
};
