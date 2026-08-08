import { autoScrollDirection, exceedsThreshold, isValidDropTarget } from './dragModel.js';
import { describe, expect, it } from 'vitest';

describe('exceedsThreshold（5px 開始しきい値）', () => {
  const start = { x: 100, y: 100 };

  it('しきい値ちょうど（5px）ではまだ開始しない', () => {
    expect(exceedsThreshold(start, { x: 105, y: 100 })).toBe(false);
  });

  it('5px を超えたら開始する', () => {
    expect(exceedsThreshold(start, { x: 106, y: 100 })).toBe(true);
  });

  it('斜め移動もユークリッド距離で判定する（3-4-5）', () => {
    // 距離 = 5（境界）→ まだ開始しない。
    expect(exceedsThreshold(start, { x: 103, y: 104 })).toBe(false);
    // 距離 ≈ 5.1 → 開始。
    expect(exceedsThreshold(start, { x: 103, y: 105 })).toBe(true);
  });

  it('全く動いていなければ開始しない', () => {
    expect(exceedsThreshold(start, { x: 100, y: 100 })).toBe(false);
  });
});

describe('autoScrollDirection（端 40px の帯）', () => {
  const rect = { top: 100, bottom: 500 };

  it('上端 40px 以内は上方向（-1）', () => {
    expect(autoScrollDirection(rect, 100)).toBe(-1);
    expect(autoScrollDirection(rect, 140)).toBe(-1);
  });

  it('下端 40px 以内は下方向（+1）', () => {
    expect(autoScrollDirection(rect, 500)).toBe(1);
    expect(autoScrollDirection(rect, 460)).toBe(1);
  });

  it('中央帯ではスクロールしない（0）', () => {
    expect(autoScrollDirection(rect, 300)).toBe(0);
    expect(autoScrollDirection(rect, 141)).toBe(0);
    expect(autoScrollDirection(rect, 459)).toBe(0);
  });

  it('ペイン外（上/下）ではスクロールしない（0）', () => {
    expect(autoScrollDirection(rect, 99)).toBe(0);
    expect(autoScrollDirection(rect, 501)).toBe(0);
  });
});

describe('isValidDropTarget（フォルダのみ・現在の親は無効）', () => {
  it('フォルダが null なら無効', () => {
    expect(isValidDropTarget(null, '1')).toBe(false);
  });

  it('現在の親フォルダは無効', () => {
    expect(isValidDropTarget('1', '1')).toBe(false);
  });

  it('別のフォルダは有効', () => {
    expect(isValidDropTarget('2', '1')).toBe(true);
  });

  it('現在の親が null（ルート直下等）でも別フォルダは有効', () => {
    expect(isValidDropTarget('2', null)).toBe(true);
  });
});
