/**
 * 固定行高の仮想スクロール（自前ウィンドウング）の可視範囲計算。
 *
 * 外部ライブラリを追加せず、表示行のみ描画して件数増加に対し描画コストを一定化する
 * （architecture.md「要件を満たせなければ自前実装」）。React・DOM に依存しない純粋関数。
 */

/** `computeWindow` の入力。 */
export interface VirtualWindowInput {
  /** スクロールコンテナの現在の scrollTop。 */
  scrollTop: number;
  /** ビューポート（可視領域）の高さ。 */
  viewportHeight: number;
  /** 1 行の固定高さ。 */
  rowHeight: number;
  /** 総アイテム数。 */
  count: number;
  /** 前後に余分に描画する行数（高速スクロール時の空白防止）。既定 4。 */
  overscan?: number;
}

/** `computeWindow` の返り値。`endIndex` は排他的。 */
export interface VirtualWindow {
  /** 描画開始インデックス（含む）。 */
  startIndex: number;
  /** 描画終了インデックス（排他的）。 */
  endIndex: number;
  /** 先頭スペーサの高さ（`startIndex * rowHeight`）。 */
  offsetY: number;
  /** 全体の高さ（`count * rowHeight`）。スクロールバー用。 */
  totalHeight: number;
}

/**
 * 描画すべき可視範囲を算出する（純粋関数）。
 * overscan 行を前後に足し、範囲は [0, count] にクランプする。
 */
export const computeWindow = ({
  scrollTop,
  viewportHeight,
  rowHeight,
  count,
  overscan = 4,
}: VirtualWindowInput): VirtualWindow => {
  const totalHeight = Math.max(0, count) * Math.max(0, rowHeight);
  if (count <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { startIndex: 0, endIndex: 0, offsetY: 0, totalHeight };
  }

  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const startIndex = Math.max(0, Math.min(first - overscan, count));
  const endIndex = Math.max(startIndex, Math.min(count, first + visibleCount + overscan));
  const offsetY = startIndex * rowHeight;

  return { startIndex, endIndex, offsetY, totalHeight };
};
