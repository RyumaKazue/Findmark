import { resolveUiLocale } from '@extension/i18n';
import { settingsStore } from '@src/services';
import { useEffect, useState } from 'react';
import type { UiLocale } from '@extension/i18n';

/**
 * 表示ロケールを解決するフック（U18）。
 *
 * 初期値はブラウザの UI 言語から即座に決め、`UserSettings.locale`（`chrome.storage.sync`）の読み込み完了後に
 * 確定値へ差し替える。**設定の読み込みを描画のブロッキング条件にしない**（PRD 非機能要件「起動→検索フォーカス
 * 200ms 以内」。U19 で既定値を先に適用したのと同じ方針）。
 *
 * UI から chrome API を直接触らず `SettingsStore`（データ層）経由で読む（レイヤー依存 UI→サービス→データ）。
 */
export const useUiLocale = (): UiLocale => {
  const [locale, setLocale] = useState<UiLocale>(() => resolveUiLocale());

  useEffect(() => {
    void settingsStore
      .get()
      .then(settings => setLocale(resolveUiLocale(settings.locale)))
      .catch((e: unknown) => console.error('[useUiLocale] 表示言語の取得に失敗しました:', e));
  }, []);

  return locale;
};
