import { computeWindow } from './virtualization.js';
import { describe, expect, it } from 'vitest';

describe('computeWindow', () => {
  it('件数0のときは空範囲を返す', () => {
    expect(computeWindow({ scrollTop: 0, viewportHeight: 560, rowHeight: 56, count: 0 })).toEqual({
      startIndex: 0,
      endIndex: 0,
      offsetY: 0,
      totalHeight: 0,
    });
  });

  it('先頭表示: overscan 分だけ後方に広がり、offsetY は 0', () => {
    const w = computeWindow({ scrollTop: 0, viewportHeight: 560, rowHeight: 56, count: 100, overscan: 4 });
    // 可視10行 + 後方overscan4 = 14
    expect(w).toEqual({ startIndex: 0, endIndex: 14, offsetY: 0, totalHeight: 5600 });
  });

  it('スクロール中: 前後 overscan を加えた範囲と offsetY を返す', () => {
    const w = computeWindow({ scrollTop: 560, viewportHeight: 560, rowHeight: 56, count: 100, overscan: 4 });
    // first=10 → start=6, end=min(100,10+10+4)=24, offsetY=6*56=336
    expect(w.startIndex).toBe(6);
    expect(w.endIndex).toBe(24);
    expect(w.offsetY).toBe(336);
    expect(w.totalHeight).toBe(5600);
  });

  it('末尾付近では endIndex が count にクランプされる', () => {
    const w = computeWindow({ scrollTop: 100 * 56, viewportHeight: 560, rowHeight: 56, count: 100, overscan: 4 });
    expect(w.endIndex).toBe(100);
    expect(w.startIndex).toBeLessThanOrEqual(w.endIndex);
    expect(w.startIndex).toBeGreaterThanOrEqual(0);
  });

  it('overscan 既定は 4', () => {
    const withDefault = computeWindow({ scrollTop: 0, viewportHeight: 560, rowHeight: 56, count: 100 });
    const withFour = computeWindow({ scrollTop: 0, viewportHeight: 560, rowHeight: 56, count: 100, overscan: 4 });
    expect(withDefault).toEqual(withFour);
  });

  it('負の scrollTop は 0 として扱う', () => {
    const w = computeWindow({ scrollTop: -100, viewportHeight: 560, rowHeight: 56, count: 100 });
    expect(w.startIndex).toBe(0);
    expect(w.offsetY).toBe(0);
  });
});
