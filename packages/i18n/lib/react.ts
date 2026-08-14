import { DEFAULT_UI_LOCALE, createTranslator } from './runtime.js';
import { createContext, createElement, useContext, useMemo } from 'react';
import type { Translator, UiLocale } from './runtime.js';
import type { ReactNode } from 'react';

/**
 * React 向けの i18n 配線（U18）。ロケールを1箇所（各ページのルート）で決め、`useI18n()` の `t` を通じて
 * ツリー全体へ配る。ロケール変更時は `Provider` の値が差し替わり、再読み込みなしで全文言が切り替わる。
 *
 * JSX を使わず `createElement` で組み立て、`packages/i18n` の tsc ビルド構成（`.ts` のみ）を保つ。
 */

interface I18nContextValue {
  locale: UiLocale;
  t: Translator;
}

/**
 * Provider の外側で `useI18n()` が呼ばれても壊れないよう、既定ロケールの翻訳関数を初期値に置く
 * （文言が既定言語で出るだけで、クラッシュしない）。
 */
const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_UI_LOCALE,
  t: createTranslator(DEFAULT_UI_LOCALE),
});

interface I18nProviderProps {
  locale: UiLocale;
  children: ReactNode;
}

const I18nProvider = ({ locale, children }: I18nProviderProps) => {
  const value = useMemo<I18nContextValue>(() => ({ locale, t: createTranslator(locale) }), [locale]);
  return createElement(I18nContext.Provider, { value }, children);
};

/** 現在の表示ロケールと翻訳関数を取得する。 */
const useI18n = (): I18nContextValue => useContext(I18nContext);

export { I18nProvider, useI18n };
export type { I18nContextValue };
