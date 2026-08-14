import { buildResultMetaLabel } from './resultMetaModel.js';
import { describe, expect, it } from 'vitest';

// U18: モデルは翻訳済み文字列ではなくメッセージキー + 置換値を返す（翻訳は UI 層の責務）。
describe('buildResultMetaLabel', () => {
  it('query あり・scope あり: スコープパス / クエリ / 件数を置換値に持つ', () => {
    expect(
      buildResultMetaLabel({ scopePath: ['開発', 'chrome'], allScopeLabel: 'すべて', query: 'docs', count: 4 }),
    ).toEqual({
      key: 'popupMetaScopedQuery',
      substitutions: ['開発 / chrome', 'docs', '4'],
    });
  });

  it('query あり・scope なし: スコープ名に「すべて」ラベルを使う', () => {
    expect(buildResultMetaLabel({ scopePath: null, allScopeLabel: 'すべて', query: 'docs', count: 4 })).toEqual({
      key: 'popupMetaScopedQuery',
      substitutions: ['すべて', 'docs', '4'],
    });
  });

  it('query なし・scope あり: ブラウズ用のキーを返す', () => {
    expect(
      buildResultMetaLabel({ scopePath: ['開発', 'chrome'], allScopeLabel: 'すべて', query: '', count: 5 }),
    ).toEqual({
      key: 'popupMetaScopedBrowse',
      substitutions: ['開発 / chrome', '5'],
    });
  });

  it('query なし・scope なし: メタ行を出さない（null）', () => {
    expect(buildResultMetaLabel({ scopePath: null, allScopeLabel: 'すべて', query: '', count: 10 })).toBeNull();
  });

  it('ロケールに依らずスコープ名は呼び出し側の指定に従う', () => {
    expect(buildResultMetaLabel({ scopePath: null, allScopeLabel: 'All', query: 'docs', count: 1 })).toEqual({
      key: 'popupMetaScopedQuery',
      substitutions: ['All', 'docs', '1'],
    });
  });
});
