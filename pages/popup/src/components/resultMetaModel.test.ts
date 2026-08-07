import { buildResultMetaLabel } from './resultMetaModel.js';
import { describe, expect, it } from 'vitest';

describe('buildResultMetaLabel', () => {
  it('query あり・scope あり: 「{パス} の中から「{query}」— N件」', () => {
    expect(buildResultMetaLabel({ scopePath: ['開発', 'chrome'], query: 'docs', count: 4 })).toBe(
      '開発 / chrome の中から「docs」— 4件',
    );
  });

  it('query あり・scope なし: 「すべて の中から「{query}」— N件」', () => {
    expect(buildResultMetaLabel({ scopePath: null, query: 'docs', count: 4 })).toBe('すべて の中から「docs」— 4件');
  });

  it('query なし・scope あり: 「{パス} の直下 — N件」', () => {
    expect(buildResultMetaLabel({ scopePath: ['開発', 'chrome'], query: '', count: 5 })).toBe(
      '開発 / chrome の直下 — 5件',
    );
  });

  it('query なし・scope なし: メタ行を出さない（null）', () => {
    expect(buildResultMetaLabel({ scopePath: null, query: '', count: 10 })).toBeNull();
  });
});
