import { CATALOGS, DEFAULT_UI_LOCALE, UI_LOCALES, createTranslator, resolveUiLocale } from './runtime.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** `chrome.i18n.getUILanguage` を差し替える（未定義環境での参照も再現できるよう globalThis を直接触る）。 */
const stubUiLanguage = (value: (() => string) | undefined): void => {
  (globalThis as { chrome?: unknown }).chrome = value ? { i18n: { getUILanguage: value } } : undefined;
};

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.restoreAllMocks();
});

describe('resolveUiLocale', () => {
  it('ユーザー設定があればブラウザ UI 言語より優先する', () => {
    stubUiLanguage(() => 'ja-JP');
    expect(resolveUiLocale('en')).toBe('en');
  });

  it('未設定なら ja 系のブラウザ UI 言語から ja を導出する', () => {
    stubUiLanguage(() => 'ja-JP');
    expect(resolveUiLocale(undefined)).toBe('ja');
  });

  it('未設定で en 系のブラウザ UI 言語なら en を導出する', () => {
    stubUiLanguage(() => 'en-US');
    expect(resolveUiLocale(null)).toBe('en');
  });

  it('未対応言語（ja 以外）は en へ倒す', () => {
    stubUiLanguage(() => 'ko');
    expect(resolveUiLocale(undefined)).toBe('en');
  });

  it('未対応の設定値（対応外ロケール文字列）はブラウザ UI 言語で解決する', () => {
    stubUiLanguage(() => 'ja');
    expect(resolveUiLocale('fr')).toBe('ja');
  });

  it('chrome API が利用できない環境では既定ロケールへ倒す', () => {
    stubUiLanguage(undefined);
    expect(resolveUiLocale(undefined)).toBe(DEFAULT_UI_LOCALE);
  });

  it('chrome API が例外を投げても既定ロケールへ倒す', () => {
    stubUiLanguage(() => {
      throw new Error('unavailable');
    });
    expect(resolveUiLocale(undefined)).toBe(DEFAULT_UI_LOCALE);
  });
});

describe('createTranslator', () => {
  it('指定ロケールの文言を返す', () => {
    expect(createTranslator('ja')('commonAll')).toBe('すべて');
    expect(createTranslator('en')('commonAll')).toBe('All');
  });

  it('位置引数 $1, $2, ... を置換する', () => {
    expect(createTranslator('ja')('popupMetaScopedQuery', ['開発 / chrome', 'docs', '4'])).toBe(
      '開発 / chrome の中から「docs」— 4件',
    );
  });

  it('単一の置換値を $1 に適用する', () => {
    expect(createTranslator('ja')('popupUndoDeleted', 'メモ')).toBe('「メモ」を削除しました');
  });

  it('同じ位置引数が複数回現れてもすべて置換する', () => {
    const t = createTranslator('ja');
    const catalog = CATALOGS.ja as Record<string, { message: string }>;
    const original = catalog['commonAll'].message;
    catalog['commonAll'] = { message: '$1 と $1' };
    try {
      expect(t('commonAll', 'X')).toBe('X と X');
    } finally {
      catalog['commonAll'] = { message: original };
    }
  });

  it('placeholders を展開する', () => {
    const catalog = CATALOGS.ja as Record<string, unknown>;
    const original = catalog['commonAll'];
    catalog['commonAll'] = { message: 'こんにちは $NAME$', placeholders: { name: { content: '$1' } } };
    try {
      expect(createTranslator('ja')('commonAll', '山田')).toBe('こんにちは 山田');
    } finally {
      catalog['commonAll'] = original;
    }
  });

  it('該当ロケールにキーが無ければ既定ロケール（ja）へフォールバックする', () => {
    const enCatalog = CATALOGS.en as Record<string, unknown>;
    const original = enCatalog['commonAll'];
    delete enCatalog['commonAll'];
    try {
      expect(createTranslator('en')('commonAll')).toBe('すべて');
    } finally {
      enCatalog['commonAll'] = original;
    }
  });

  it('どのロケールにも無いキーは例外を投げずキー文字列を返す', () => {
    // 型上は存在しないキーだが、カタログ更新漏れの実行時挙動（UI を壊さない）を担保する。
    const t = createTranslator('ja') as unknown as (key: string) => string;
    expect(t('missingKeyForTest')).toBe('missingKeyForTest');
  });
});

describe('カタログ整合', () => {
  it('全ロケールのキー集合が完全一致する', () => {
    const [base, ...rest] = UI_LOCALES;
    const baseKeys = Object.keys(CATALOGS[base]).sort();
    rest.forEach(locale => {
      expect(Object.keys(CATALOGS[locale]).sort()).toEqual(baseKeys);
    });
  });

  it('空の message を持つキーが存在しない', () => {
    UI_LOCALES.forEach(locale => {
      Object.entries(CATALOGS[locale]).forEach(([key, value]) => {
        expect(value.message.length, `${locale}/${key}`).toBeGreaterThan(0);
      });
    });
  });
});
