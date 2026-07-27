import { Normalizer, normalizer } from './Normalizer.js';
import { describe, expect, it } from 'vitest';

describe('Normalizer.normalizeText', () => {
  it('全角英数と半角英数を同値化する', () => {
    expect(normalizer.normalizeText('ＡＢＣ123')).toBe('abc123');
    expect(normalizer.normalizeText('ＡＢＣ123')).toBe(normalizer.normalizeText('abc123'));
  });

  it('大文字小文字を同値化する', () => {
    expect(normalizer.normalizeText('GitHub')).toBe('github');
    expect(normalizer.normalizeText('GITHUB')).toBe(normalizer.normalizeText('github'));
  });

  it('カタカナとひらがなを同値化する', () => {
    expect(normalizer.normalizeText('ギットハブ')).toBe('ぎっとはぶ');
    expect(normalizer.normalizeText('ギットハブ')).toBe(normalizer.normalizeText('ぎっとはぶ'));
  });

  it('半角カナを NFKC 経由で全角化し、さらにひらがなへ同値化する', () => {
    expect(normalizer.normalizeText('ｷﾞｯﾄ')).toBe('ぎっと');
    expect(normalizer.normalizeText('ｷﾞｯﾄ')).toBe(normalizer.normalizeText('ぎっと'));
  });

  it('英字とカナが混在した文字列を正規化する', () => {
    expect(normalizer.normalizeText('Ａpple ﾘﾝｺﾞ')).toBe('apple りんご');
  });

  it('空文字はそのまま空文字を返す', () => {
    expect(normalizer.normalizeText('')).toBe('');
  });
});

describe('Normalizer.normalizeUrl', () => {
  it('フラグメント(#...)を保持する（ハッシュルーティングの SPA でページを識別するため）', () => {
    expect(normalizer.normalizeUrl('https://ex.com/docs#install')).toBe('https://ex.com/docs#install');
  });

  it('フラグメントだけ異なる URL は別の正規形になる', () => {
    expect(normalizer.normalizeUrl('https://ex.com/docs#install')).not.toBe(
      normalizer.normalizeUrl('https://ex.com/docs#usage'),
    );
  });

  it('ハッシュルーティング SPA の別ページを別 URL として区別する（回帰: 別名の誤共有防止）', () => {
    expect(normalizer.normalizeUrl('https://claude.ai/new#settings/usage')).not.toBe(
      normalizer.normalizeUrl('https://claude.ai/new'),
    );
  });

  it('末尾スラッシュを正規化する(/path/ → /path)', () => {
    expect(normalizer.normalizeUrl('https://ex.com/blog/')).toBe('https://ex.com/blog');
    expect(normalizer.normalizeUrl('https://ex.com/blog/')).toBe(normalizer.normalizeUrl('https://ex.com/blog'));
  });

  it('ルート / 単体は保持する', () => {
    expect(normalizer.normalizeUrl('https://ex.com/')).toBe('https://ex.com/');
    // パスなしとルート / は同一の正規形に寄る
    expect(normalizer.normalizeUrl('https://ex.com')).toBe(normalizer.normalizeUrl('https://ex.com/'));
  });

  it('クエリ(?...)は保持する', () => {
    expect(normalizer.normalizeUrl('https://ex.com/search?q=cat')).toBe('https://ex.com/search?q=cat');
  });

  it('異なるクエリは別 URL として区別する', () => {
    expect(normalizer.normalizeUrl('https://ex.com/search?q=cat')).not.toBe(
      normalizer.normalizeUrl('https://ex.com/search?q=dog'),
    );
  });

  it('フラグメント保持・末尾スラッシュ・クエリ保持が同時に効く', () => {
    expect(normalizer.normalizeUrl('https://ex.com/a/b/?ref=x#top')).toBe('https://ex.com/a/b?ref=x#top');
  });

  it('不正な URL では throw する', () => {
    expect(() => normalizer.normalizeUrl('not a url')).toThrow();
  });
});

describe('Normalizer.hashUrl', () => {
  it('同一 URL からは常に同一ハッシュ（決定的）', () => {
    expect(normalizer.hashUrl('https://ex.com/a')).toBe(normalizer.hashUrl('https://ex.com/a'));
  });

  it('フラグメントだけ異なる URL は別ハッシュになる（別ページとして別名を独立させる）', () => {
    expect(normalizer.hashUrl('https://ex.com/docs#a')).not.toBe(normalizer.hashUrl('https://ex.com/docs#b'));
  });

  it('末尾スラッシュの有無を吸収して同一ハッシュになる', () => {
    expect(normalizer.hashUrl('https://ex.com/blog/')).toBe(normalizer.hashUrl('https://ex.com/blog'));
  });

  it('クエリが異なる URL は別ハッシュになる', () => {
    expect(normalizer.hashUrl('https://ex.com/s?q=cat')).not.toBe(normalizer.hashUrl('https://ex.com/s?q=dog'));
  });

  it('同期関数であり文字列を返す（Promise を返さない）', () => {
    const result = normalizer.hashUrl('https://ex.com/a');
    expect(typeof result).toBe('string');
    expect(result).not.toBeInstanceOf(Promise);
    // 符号なし 16 進表現である
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('現実的なサンプルでハッシュが衝突しない', () => {
    const urls = [
      'https://github.com/anthropics/claude-code',
      'https://github.com/anthropics/anthropic-sdk',
      'https://example.com/',
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/search?q=cat',
      'https://example.com/search?q=dog',
      'https://news.example.com/2026/07/article',
    ];
    const hashes = urls.map(url => normalizer.hashUrl(url));
    expect(new Set(hashes).size).toBe(urls.length);
  });

  it('不正な URL では throw する（normalizeUrl 経由）', () => {
    expect(() => normalizer.hashUrl('not a url')).toThrow();
  });
});

describe('Normalizer クラス', () => {
  it('new でインスタンス化でき、既定インスタンスと同じ結果を返す', () => {
    const n = new Normalizer();
    expect(n.normalizeText('ＡＢＣ')).toBe(normalizer.normalizeText('ＡＢＣ'));
    expect(n.hashUrl('https://ex.com/a')).toBe(normalizer.hashUrl('https://ex.com/a'));
  });
});
