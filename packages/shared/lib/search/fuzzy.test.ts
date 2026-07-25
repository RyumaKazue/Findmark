import { approxSubstringDistance, fuzzyThreshold } from './fuzzy.js';
import { describe, expect, it } from 'vitest';

describe('approxSubstringDistance', () => {
  it('pattern が text の部分文字列として完全一致するとき距離0を返す', () => {
    expect(approxSubstringDistance('git', 'my github repo')).toBe(0);
    expect(approxSubstringDistance('github', 'github')).toBe(0);
  });

  it('1文字の置換で一致する場合は距離1を返す', () => {
    expect(approxSubstringDistance('hub', 'hab')).toBe(1);
    expect(approxSubstringDistance('github', 'githup')).toBe(1);
  });

  it('1文字の挿入/削除で一致する場合は距離1を返す', () => {
    expect(approxSubstringDistance('github', 'githb')).toBe(1); // 1文字削除
    expect(approxSubstringDistance('githb', 'github')).toBe(1); // 1文字挿入
  });

  it('text 中の最短一致部分文字列との距離を返す(短い部分文字列への挿入で近づける場合はその距離を採用)', () => {
    // 'gti' は 'github' の部分文字列 'gi' へ 't' を1挿入するだけで到達できるため距離1。
    expect(approxSubstringDistance('gti', 'github')).toBe(1);
  });

  it('似ていない文字列同士は距離2以上になる', () => {
    expect(approxSubstringDistance('xqz', 'github')).toBeGreaterThanOrEqual(2);
  });

  it('pattern が空文字のとき距離0を返す', () => {
    expect(approxSubstringDistance('', 'anything')).toBe(0);
  });

  it('text が空文字のとき pattern の長さを返す', () => {
    expect(approxSubstringDistance('abc', '')).toBe(3);
  });

  it('全く似ていない場合は大きい距離を返す', () => {
    expect(approxSubstringDistance('xyz', 'abc')).toBeGreaterThanOrEqual(3);
  });
});

describe('fuzzyThreshold', () => {
  it('4文字以下は距離1までを許容する', () => {
    expect(fuzzyThreshold(1)).toBe(1);
    expect(fuzzyThreshold(4)).toBe(1);
  });

  it('5文字以上は距離2までを許容する', () => {
    expect(fuzzyThreshold(5)).toBe(2);
    expect(fuzzyThreshold(10)).toBe(2);
  });
});
