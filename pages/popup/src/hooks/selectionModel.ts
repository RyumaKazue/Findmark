/**
 * 複数選択（U13・機能8）の純粋ロジック。`selection-mode` で「選択モード」を state に取り込んだ。
 *
 * React / `chrome.*` に非依存の純粋関数群であり、`useSelection`（React 層）とユニットテスト
 * （`selectionModel.test.ts`）から利用する。既存の pure module（`modeMachine.ts` / `folderTreeModel.ts`）に倣い、
 * 宣言は非 export とし、ファイル末尾で export をまとめる。
 *
 * 選択はフォーカス（`selectedIndex`）・モード（`useMode`）・スコープと直交する独立した状態として扱う
 * （Gmail/Finder 型: ハイライトとチェック選択は別軸）。呼び出し側（Popup）はクエリ/スコープ変更時に
 * `clear()` を呼び、選択を常に「現在の表示結果の部分集合」に保つ（幽霊選択・件数不整合を避ける）。
 *
 * **選択モード（`active`）を UI 側の flag ではなく本 state に置く理由**（`selection-mode`）:
 * 行クリックの意味は「開く（通常）/ 選ぶ（選択モード）」でモードにより変わるため、**選択があるのにモードが
 * OFF** という状態は「選ぼうとしたのにサイトが開く」＝本単位が解消しようとした誤操作そのものを再発させる。
 * そこで `ids.size > 0 ⇒ active === true` を**モデルの不変条件**とし、選択を発生させる全操作
 * （`toggle`/`rangeTo`/`selectAll`）が `active` を立てる。Popup 側で `enterSelectionMode()` を並べて書く方式だと
 * 1箇所の書き忘れが上記の不整合になるため、遷移規則をここに閉じ込めてユニットテストで固定する。
 */

/** 選択状態。`anchorId` は Shift+クリックの範囲選択の起点（個別クリック時のみ更新）。 */
interface SelectionState {
  ids: ReadonlySet<string>;
  anchorId: string | null;
  /**
   * 選択モード（行クリック＝選択・行を開かない）か。`ids.size > 0` なら必ず `true`（不変条件）。
   * 逆は成立しない: 選択0件のまま選択モードに留まる状態は正常（モードに入った直後・全解除した直後）。
   */
  active: boolean;
}

/** 初期状態（通常モード・非選択）。 */
const emptySelection: SelectionState = { ids: new Set(), anchorId: null, active: false };

/** 指定 id が選択中か。 */
const isSelected = (state: SelectionState, id: string): boolean => state.ids.has(id);

/** 選択モードを開始する（既存の選択は保持する）。 */
const activate = (state: SelectionState): SelectionState => (state.active ? state : { ...state, active: true });

/**
 * 選択モードを終了する。**選択（ids/anchor）も同時に捨てる**。
 * 「終了＝選択も無かったことにする」を1箇所で保証し、モード終了後に幽霊選択が残らないようにする
 * （終了導線はヘッダーのトグル・Escape・一括操作バーの[選択解除]・一括操作完了後の4つある）。
 */
const deactivate = (): SelectionState => emptySelection;

/** ヘッダーのトグルボタン用。OFF→ON は選択を保持し、ON→OFF は選択も捨てる（`deactivate`）。 */
const toggleActive = (state: SelectionState): SelectionState => (state.active ? deactivate() : activate(state));

/**
 * 個別トグル（行クリック（選択モード中）・Ctrl/Cmd+クリック）。id の選択有無を反転し、
 * anchor を id に更新する（次の Shift+クリックの起点にする）。
 *
 * 通常モードからの Ctrl/Cmd+クリックでも呼ばれるため、ここで `active` を立てて選択モードへ入る
 * （選択が生まれた瞬間に「行クリック＝選択」へ切り替わる＝不変条件）。最後の1件を外して0件になっても
 * `active` は `true` のまま維持する（勝手にモードを抜けると次のクリックが「開く」に化けるため）。
 */
const toggle = (state: SelectionState, id: string): SelectionState => {
  const next = new Set(state.ids);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return { ids: next, anchorId: id, active: true };
};

/**
 * 範囲選択（Shift+クリック）。`orderedIds` 上で anchor と target の間（両端含む）を既存選択へ union する。
 * anchor が無い場合（初回の Shift+クリック等）は target の単一選択に倒す。
 * anchor は更新しない（Gmail 準拠: 連続 Shift+クリックは常に最初の anchor からの範囲になる）。
 */
const rangeTo = (state: SelectionState, targetId: string, orderedIds: readonly string[]): SelectionState => {
  if (state.anchorId === null) {
    return { ids: new Set([targetId]), anchorId: targetId, active: true };
  }
  const anchorIndex = orderedIds.indexOf(state.anchorId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (anchorIndex === -1 || targetIndex === -1) {
    // どちらかが現在の一覧に無い（フィルタ変更等）場合は単一選択へ倒す。
    return { ids: new Set([targetId]), anchorId: targetId, active: true };
  }
  const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  const next = new Set(state.ids);
  for (let i = start; i <= end; i++) {
    next.add(orderedIds[i]);
  }
  return { ids: next, anchorId: state.anchorId, active: true };
};

/**
 * 全件選択（Ctrl/Cmd+A）。anchor は先頭 id にする（以降の Shift+クリックの起点）。
 * `toggle`/`rangeTo` と同じく選択モードへ入る（通常モードからの Ctrl/Cmd+A も選択の入口になる）。
 */
const selectAll = (orderedIds: readonly string[]): SelectionState => ({
  ids: new Set(orderedIds),
  anchorId: orderedIds[0] ?? null,
  active: true,
});

/**
 * 選択解除。**選択モード（`active`）は保つ**。クエリ/スコープ変更で選択を捨てる用途であり、
 * ここでモードまで抜けると「検索し直して選び直す」動線が毎回モードの入れ直しを強いられるため。
 * モードごと終わらせたい場合は `deactivate`（終了導線）を使う。
 */
const clear = (state: SelectionState): SelectionState => ({ ids: new Set(), anchorId: null, active: state.active });

export { emptySelection, isSelected, activate, deactivate, toggleActive, toggle, rangeTo, selectAll, clear };
export type { SelectionState };
