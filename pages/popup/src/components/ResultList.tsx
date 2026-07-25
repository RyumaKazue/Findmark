import { ResultRow } from './ResultRow.js';
import { computeWindow } from './virtualization.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SearchResultItem } from '@extension/shared';

/** 結果行の固定高さ（docs/design「固定寸法」56px）。仮想スクロールの前提。 */
const ROW_HEIGHT = 56;

interface ResultListProps {
  results: SearchResultItem[];
  /** ↑↓/ホバーで選択中のインデックス。 */
  selectedIndex: number;
  /** 結果0件時に中央表示する文言（読み込み中/本当に0件を呼び出し側が出し分ける）。 */
  emptyLabel: string;
  /** 指定インデックスのブックマークを開く。 */
  onOpen: (index: number) => void;
  /** ホバーで選択インデックスを合わせる。 */
  onHover: (index: number) => void;
}

/**
 * 右ペインの検索結果リスト（自前の仮想スクロール）。
 * 固定行高で可視範囲のみ描画し、件数増加に対して描画コストを一定化する（docs/architecture パフォーマンス）。
 */
export const ResultList = ({ results, selectedIndex, emptyLabel, onOpen, onHover }: ResultListProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // レイアウト確定後にビューポート高を取得する（flex:1 のため確定値になる）。
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) {
      setViewportHeight(el.clientHeight);
    }
  }, []);

  // 選択行が可視範囲外なら追従してスクロールする。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || results.length === 0) {
      return;
    }
    const rowTop = selectedIndex * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < el.scrollTop) {
      el.scrollTop = rowTop;
    } else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowBottom - el.clientHeight;
    }
  }, [selectedIndex, results.length]);

  if (results.length === 0) {
    return (
      <div className="text-ink-faint flex h-full items-center justify-center px-6 text-center text-[12.5px]">
        {emptyLabel}
      </div>
    );
  }

  const { startIndex, endIndex, offsetY, totalHeight } = computeWindow({
    scrollTop,
    viewportHeight,
    rowHeight: ROW_HEIGHT,
    count: results.length,
  });
  const visible = results.slice(startIndex, endIndex);

  return (
    <div ref={containerRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} className="h-full overflow-auto">
      {/* 総高スペーサ + 可視分のみ translateY で配置 */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)`, position: 'absolute', top: 0, left: 0, right: 0 }}>
          {visible.map((item, i) => {
            const index = startIndex + i;
            return (
              <ResultRow
                key={item.node.id}
                item={item}
                selected={index === selectedIndex}
                onOpen={() => onOpen(index)}
                onHover={() => onHover(index)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
