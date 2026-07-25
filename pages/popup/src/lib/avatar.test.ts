import { AVATAR_PALETTE, avatarFor } from './avatar.js';
import { describe, expect, it } from 'vitest';

describe('avatarFor', () => {
  it('同一ドメインは常に同色になる（別パス・別スキームでも一致）', () => {
    const a = avatarFor('https://github.com/foo');
    const b = avatarFor('http://github.com/bar?x=1#h');
    expect(a.color).toBe(b.color);
  });

  it('`www.` の有無で同色になる（ホスト正規化）', () => {
    expect(avatarFor('https://www.example.com').color).toBe(avatarFor('https://example.com/a').color);
  });

  it('色は必ず9色パレット内から選ばれる', () => {
    for (const url of ['https://a.com', 'https://b.org', 'https://c.net', 'https://developer.chrome.com']) {
      expect(AVATAR_PALETTE).toContain(avatarFor(url).color);
    }
  });

  it('異なるドメインは（多くの場合）異なる色に分散する', () => {
    const colors = ['https://github.com', 'https://developer.chrome.com', 'https://figma.com'].map(
      u => avatarFor(u).color,
    );
    // 3ドメインが全て同色になることはハッシュ上ほぼ無い（分散していることの緩い検証）。
    expect(new Set(colors).size).toBeGreaterThan(1);
  });

  it('頭文字はホスト先頭の英数字を大文字化する', () => {
    expect(avatarFor('https://github.com').initial).toBe('G');
    expect(avatarFor('https://www.example.com').initial).toBe('E');
    expect(avatarFor('https://1.2.3.4/x').initial).toBe('1');
  });

  it('不正な URL・ホスト無しでは頭文字 `#` にフォールバックする', () => {
    expect(avatarFor('not a url').initial).toBe('#');
    expect(avatarFor('').initial).toBe('#');
    // 不正時も色はパレット内（描画が壊れない）。
    expect(AVATAR_PALETTE).toContain(avatarFor('not a url').color);
  });
});
