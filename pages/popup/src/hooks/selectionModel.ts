/**
 * 複数選択（U13・機能8）の純粋ロジック。
 *
 * React / `chrome.*` に非依存の純粋関数群であり、`useSelection`（React 層）とユニットテスト
 * （`selectionModel.test.ts`）から利用する。既存の pure module（`modeMachine.ts` / `folderTreeModel.ts`）に倣い、
 * 宣言は非 export とし、ファイル末尾で export をまとめる。
 *
 * 選択はフォーカス（`selectedIndex`）・モード（`useMode`）・スコープと直交する独立した状態として扱う
 * （Gmail/Finder 型: ハイライトとチェック選択は別軸）。呼び出し側（Popup）はクエリ/スコープ変更時に
 * `clear()` を呼び、選択を常に「現在の表示結果の部分集合」に保つ（幽霊選択・件数不整合を避ける）。
 */

/** 選択状態。`anchorId` は Shift+クリックの範囲選択の起点（個別クリック時のみ更新）。 */
interface SelectionState {
  ids: ReadonlySet<string>;
  anchorId: string | null;
}

/** 初期状態（非選択）。 */
const emptySelection: SelectionState = { ids: new Set(), anchorId: null };

/** 指定 id が選択中か。 */
const isSelected = (state: SelectionState, id: string): boolean => state.ids.has(id);

/**
 * 個別トグル（Ctrl/Cmd+クリック・チェックボックスクリック）。id の選択有無を反転し、
 * anchor を id に更新する（次の Shift+クリックの起点にする）。
 */
const toggle = (state: SelectionState, id: string): SelectionState => {
  const next = new Set(state.ids);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return { ids: next, anchorId: id };
};

/**
 * 範囲選択（Shift+クリック）。`orderedIds` 上で anchor と target の間（両端含む）を既存選択へ union する。
 * anchor が無い場合（初回の Shift+クリック等）は target の単一選択に倒す。
 * anchor は更新しない（Gmail 準拠: 連続 Shift+クリックは常に最初の anchor からの範囲になる）。
 */
const rangeTo = (state: SelectionState, targetId: string, orderedIds: readonly string[]): SelectionState => {
  if (state.anchorId === null) {
    return { ids: new Set([targetId]), anchorId: targetId };
  }
  const anchorIndex = orderedIds.indexOf(state.anchorId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (anchorIndex === -1 || targetIndex === -1) {
    // どちらかが現在の一覧に無い（フィルタ変更等）場合は単一選択へ倒す。
    return { ids: new Set([targetId]), anchorId: targetId };
  }
  const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  const next = new Set(state.ids);
  for (let i = start; i <= end; i++) {
    next.add(orderedIds[i]);
  }
  return { ids: next, anchorId: state.anchorId };
};

/** 全件選択（Ctrl/Cmd+A）。anchor は先頭 id にする（以降の Shift+クリックの起点）。 */
const selectAll = (orderedIds: readonly string[]): SelectionState => ({
  ids: new Set(orderedIds),
  anchorId: orderedIds[0] ?? null,
});

/** 選択解除。 */
const clear = (): SelectionState => emptySelection;

export { emptySelection, isSelected, toggle, rangeTo, selectAll, clear };
export type { SelectionState };
