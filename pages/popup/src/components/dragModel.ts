/**
 * ドラッグ&ドロップ（U12）の座標・しきい値判定の純粋ロジック。
 *
 * DOM / React / chrome API に非依存の純粋関数群にし、`useDragAndDrop`（DOM 結線）とユニットテスト
 * （`dragModel.test.ts`）から利用する。既存の pure module（`virtualization.ts`/`folderTreeModel.ts`）に
 * 倣い、宣言は非 export とし、ファイル末尾で export をまとめる。
 *
 * 出典: PRD 機能7「結果行全体をドラッグ可能(5px以上の移動で開始)」「閉じたフォルダに600msホバーで
 * 自動展開(スプリングロード)、ペイン上下端40pxでオートスクロール」「ドロップ先はフォルダのみ。
 * 現在の親フォルダはグレーアウトして無効化する」。
 */

/** ドラッグ開始のしきい値（px）。開始点からこの距離を超えて動いたら DRAG 開始。 */
const DRAG_THRESHOLD_PX = 5;
/** オートスクロールを発火するペイン端の帯の高さ（px）。 */
const AUTOSCROLL_EDGE_PX = 40;
/** スプリングロード（閉じたフォルダの自動展開）までのホバー時間（ms）。 */
const SPRING_LOAD_MS = 600;

interface Point {
  x: number;
  y: number;
}

/**
 * 開始点からの移動がドラッグ開始しきい値（5px）を超えたか（ユークリッド距離）。
 * わずかな手ぶれでクリックがドラッグに化けるのを防ぐため、距離ベースで判定する。
 * ちょうど 5.0px では開始しない（厳密不等号）。これは意図的で、境界上の微小なブレを
 * クリックとして扱い、誤ドラッグを一段抑える（PRD「5px以上」を「5px を明確に超えたら」と解する）。
 */
const exceedsThreshold = (start: Point, current: Point): boolean => {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
};

/** オートスクロール判定に使うペインの縦範囲（ビューポート座標）。 */
interface EdgeRect {
  top: number;
  bottom: number;
}

/**
 * ペイン矩形と現在の Y 座標から、オートスクロールの方向を返す。
 * 上端 40px 以内なら上（-1）、下端 40px 以内なら下（+1）、それ以外は 0。
 * ペイン外（top より上 / bottom より下）は 0（ペイン内でのみスクロールする）。
 */
const autoScrollDirection = (rect: EdgeRect, y: number): -1 | 0 | 1 => {
  if (y < rect.top || y > rect.bottom) {
    return 0;
  }
  if (y <= rect.top + AUTOSCROLL_EDGE_PX) {
    return -1;
  }
  if (y >= rect.bottom - AUTOSCROLL_EDGE_PX) {
    return 1;
  }
  return 0;
};

/**
 * ドロップ先フォルダが有効か。フォルダが存在し（null でなく）、かつ現在の親フォルダでないこと。
 * 現在の親への移動は無意味なため無効化する（PRD 機能7「現在の親フォルダはグレーアウトして無効化」）。
 */
const isValidDropTarget = (folderId: string | null, currentParentId: string | null): boolean =>
  folderId !== null && folderId !== currentParentId;

export {
  exceedsThreshold,
  autoScrollDirection,
  isValidDropTarget,
  DRAG_THRESHOLD_PX,
  AUTOSCROLL_EDGE_PX,
  SPRING_LOAD_MS,
};
export type { Point, EdgeRect };
