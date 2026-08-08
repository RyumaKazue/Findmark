import { Favicon } from './Favicon.js';

interface DragGhostProps {
  /** ドラッグ中のブックマークのタイトル。 */
  title: string;
  /** ファビコン用 URL。 */
  url: string;
  /** 運んでいる件数（単一行は 1。複数選択の一括ドラッグは U13）。 */
  count: number;
  /** カーソル座標（ビューポート基準。Popup ルートが position: relative のため相対配置になる）。 */
  x: number;
  /** カーソル座標。 */
  y: number;
}

/**
 * ドラッグ中の浮遊ゴースト（design 1g・U12）。
 *
 * カーソルに追従する半透明カード。中身はファビコン + タイトル（ellipsis）+ 件数バッジ。
 * `pointer-events-none` でヒットテスト（`elementFromPoint` によるドロップ先判定）を妨げない。
 * 位置はカーソルからわずかにオフセットして、カーソル直下の要素判定を邪魔しないようにする。
 */
export const DragGhost = ({ title, url, count, x, y }: DragGhostProps) => (
  <div
    aria-hidden="true"
    className="shadow-drag-ghost border-line pointer-events-none fixed z-30 flex w-[320px] items-center gap-2 rounded-lg border bg-white px-3.5 py-2.5 opacity-[0.94]"
    style={{ left: x + 12, top: y + 8, transform: 'rotate(-1.5deg)' }}>
    <Favicon url={url} />
    <span className="text-ink flex-1 truncate text-[13px] font-medium">{title}</span>
    <span className="bg-accent flex h-5 min-w-[20px] flex-none items-center justify-center rounded-full px-1 font-mono text-[11px] font-bold text-white">
      {count}
    </span>
  </div>
);
