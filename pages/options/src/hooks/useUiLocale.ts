import { resolveUiLocale } from '@extension/i18n';
import { settingsStore } from '@src/services';
import { useCallback, useEffect, useState } from 'react';
import type { UiLocale } from '@extension/i18n';

interface UseUiLocaleApi {
  /** 現在の表示ロケール。 */
  locale: UiLocale;
  /** 設定タブでの言語変更を即時に反映する（保存自体は呼び出し側が `SettingsStore` へ行う）。 */
  applyLocale: (locale: UiLocale) => void;
}

/**
 * 表示ロケールを解決するフック（U18・Options 版）。
 *
 * Popup 版（`pages/popup/src/hooks/useUiLocale.ts`）との違いは、設定タブでの変更を**再読み込みなしで**
 * 反映するための `applyLocale` を持つこと。ページごとに `services.ts`（結線モジュール）が別なので、
 * 共有パッケージには置かずページ単位で薄く実装する。
 */
export const useUiLocale = (): UseUiLocaleApi => {
  const [locale, setLocale] = useState<UiLocale>(() => resolveUiLocale());

  useEffect(() => {
    void settingsStore
      .get()
      .then(settings => setLocale(resolveUiLocale(settings.locale)))
      .catch((e: unknown) => console.error('[useUiLocale] 表示言語の取得に失敗しました:', e));
  }, []);

  const applyLocale = useCallback((next: UiLocale) => setLocale(next), []);

  return { locale, applyLocale };
};
