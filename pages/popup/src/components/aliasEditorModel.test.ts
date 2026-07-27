import {
  MAX_ALIASES,
  MAX_ALIAS_LENGTH,
  commitAlias,
  orderMatchedFirst,
  removeAt,
  removeLast,
} from './aliasEditorModel.js';
import { normalizer } from '@extension/shared';
import { describe, expect, it } from 'vitest';

// 重複判定は実 Normalizer（NFKC・小文字化・カナ統一）を注入して実挙動で検証する。
const normalize = (s: string): string => normalizer.normalizeText(s);

describe('commitAlias', () => {
  it('新規の別名を末尾に追加する（added）', () => {
    const result = commitAlias(['docs'], 'かくちょう', normalize);
    expect(result).toEqual({ type: 'added', aliases: ['docs', 'かくちょう'] });
  });

  it('前後の空白を除去して追加する', () => {
    const result = commitAlias([], '  github  ', normalize);
    expect(result).toEqual({ type: 'added', aliases: ['github'] });
  });

  it('空白のみの入力は empty（追加しない）', () => {
    expect(commitAlias(['a'], '   ', normalize)).toEqual({ type: 'empty' });
    expect(commitAlias(['a'], '', normalize)).toEqual({ type: 'empty' });
  });

  it(`${MAX_ALIAS_LENGTH}文字ちょうどは追加でき、超過は too-long`, () => {
    const exact = 'a'.repeat(MAX_ALIAS_LENGTH);
    expect(commitAlias([], exact, normalize)).toEqual({ type: 'added', aliases: [exact] });

    const tooLong = 'a'.repeat(MAX_ALIAS_LENGTH + 1);
    expect(commitAlias([], tooLong, normalize)).toEqual({ type: 'too-long' });
  });

  it('正規化して既存と一致する場合は duplicate（該当 index を返す）', () => {
    // 全角/大文字/半角カナ が正規化で既存チップと一致する。
    expect(commitAlias(['github', 'かくちょう'], 'ＧitＨｕｂ', normalize)).toEqual({ type: 'duplicate', index: 0 });
    expect(commitAlias(['github', 'かくちょう'], 'ｶｸﾁｮｳ', normalize)).toEqual({ type: 'duplicate', index: 1 });
  });

  it('個数上限に達している場合は at-limit（新規は追加しない）', () => {
    const full = Array.from({ length: MAX_ALIASES }, (_, i) => `alias${i}`);
    expect(commitAlias(full, 'new', normalize)).toEqual({ type: 'at-limit' });
  });

  it('上限到達後でも既存重複は at-limit ではなく duplicate を優先する', () => {
    const full = Array.from({ length: MAX_ALIASES }, (_, i) => `alias${i}`);
    expect(commitAlias(full, 'alias3', normalize)).toEqual({ type: 'duplicate', index: 3 });
  });
});

describe('removeAt / removeLast', () => {
  it('removeAt は指定位置を除いた新配列を返す（不変）', () => {
    const src = ['a', 'b', 'c'];
    expect(removeAt(src, 1)).toEqual(['a', 'c']);
    expect(src).toEqual(['a', 'b', 'c']); // 元配列は不変
  });

  it('removeAt の範囲外はすべて残る', () => {
    expect(removeAt(['a', 'b'], 5)).toEqual(['a', 'b']);
  });

  it('removeLast は末尾を除いた新配列を返す', () => {
    expect(removeLast(['a', 'b', 'c'])).toEqual(['a', 'b']);
  });

  it('removeLast は空配列でも安全（空配列を返す）', () => {
    expect(removeLast([])).toEqual([]);
  });
});

describe('orderMatchedFirst', () => {
  it('マッチした別名を相対順を保って先頭へ寄せる', () => {
    expect(orderMatchedFirst(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['a', 'c', 'b', 'd']);
  });

  it('マッチが無ければ元の順序のまま', () => {
    expect(orderMatchedFirst(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('存在しないマッチ指定は無視される', () => {
    expect(orderMatchedFirst(['a', 'b'], ['zzz'])).toEqual(['a', 'b']);
  });
});
