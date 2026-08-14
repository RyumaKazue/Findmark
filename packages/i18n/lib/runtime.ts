import enCatalog from '../locales/en/messages.json' with { type: 'json' };
import jaCatalog from '../locales/ja/messages.json' with { type: 'json' };
import type { I18nValueType } from './types.js';

/**
 * UI 文言のランタイム解決（U18）。
 *
 * `chrome.i18n.getMessage`（`lib/i18n.ts` の `t`）は**ブラウザの UI 言語しか参照しない**ため、
 * `UserSettings.locale` によるアプリ内の言語切替を実現できない。本モジュールは `_locales` と同一の
 * カタログ（`locales/{ja,en}/messages.json`）をバンドルに取り込み、ロケールを引数で受け取る翻訳関数を
 * 提供する。manifest の `__MSG_*` は従来どおり Chrome が `_locales` から解決する（文言の二重管理はしない）。
 *
 * React 非依存（`lib/react.ts` が本モジュールを包む）。
 */

/** UI として提供するロケール（PRD「互換性 / 国際化」: 日本語 / 英語）。 */
const UI_LOCALES = ['ja', 'en'] as const;

type UiLocale = (typeof UI_LOCALES)[number];

/** 既定ロケール（manifest の `default_locale` と一致させる）。 */
const DEFAULT_UI_LOCALE: UiLocale = 'ja';

/** メッセージキー。既定ロケールのカタログを型の正とする。 */
type MessageKey = keyof typeof jaCatalog;

type Catalog = Record<string, I18nValueType>;

const CATALOGS: Record<UiLocale, Catalog> = {
  ja: jaCatalog as Catalog,
  en: enCatalog as Catalog,
};

/** 翻訳関数。`substitutions` は `$1`, `$2`, ... の順で置換する。 */
type Translator = (key: MessageKey, substitutions?: string | string[]) => string;

const isUiLocale = (value: unknown): value is UiLocale =>
  typeof value === 'string' && (UI_LOCALES as readonly string[]).includes(value);

/**
 * ブラウザの UI 言語から表示ロケールを導出する。
 * 日本語（`ja` / `ja-JP` 等）なら `ja`、それ以外は `en`。取得できない環境（テスト等）では既定ロケール。
 */
const detectBrowserUiLocale = (): UiLocale => {
  try {
    if (typeof chrome === 'undefined' || typeof chrome.i18n?.getUILanguage !== 'function') {
      return DEFAULT_UI_LOCALE;
    }
    const language = chrome.i18n.getUILanguage();
    return language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  } catch {
    // chrome API が利用できない場合も UI は必ず描画する（既定ロケールへ倒す）。
    return DEFAULT_UI_LOCALE;
  }
};

/**
 * 表示ロケールを決める。ユーザー設定（`UserSettings.locale`）を最優先し、未設定ならブラウザの UI 言語に従う。
 */
const resolveUiLocale = (setting?: string | null): UiLocale =>
  isUiLocale(setting) ? setting : detectBrowserUiLocale();

/**
 * `placeholders` の展開（`$NAME$`）と位置引数（`$1`, `$2`, ...）の置換を行う。
 * `chrome.i18n.getMessage` の挙動に合わせる（`lib/i18n-dev.ts` と同方針）。
 */
const applySubstitutions = (value: I18nValueType, substitutions?: string | string[]): string => {
  let message = value.message;

  if (value.placeholders) {
    Object.entries(value.placeholders).forEach(([name, { content }]) => {
      if (content) {
        message = message.replace(new RegExp(`\\$${name}\\$`, 'gi'), content);
      }
    });
  }

  if (substitutions === undefined) {
    return message;
  }

  const values = Array.isArray(substitutions) ? substitutions : [substitutions];
  return values.reduce((acc, value, index) => acc.replaceAll(`$${index + 1}`, value), message);
};

/**
 * 指定ロケールの翻訳関数を生成する。
 *
 * キーが該当ロケールに無ければ既定ロケール（ja）→ キー文字列の順にフォールバックし、**例外を投げない**
 * （文言の欠落で UI を壊さない。development-guidelines「エラーハンドリング」）。
 */
const createTranslator =
  (locale: UiLocale): Translator =>
  (key, substitutions) => {
    const value = CATALOGS[locale][key] ?? CATALOGS[DEFAULT_UI_LOCALE][key];
    return value ? applySubstitutions(value, substitutions) : key;
  };

export { UI_LOCALES, DEFAULT_UI_LOCALE, CATALOGS, isUiLocale, resolveUiLocale, createTranslator };
export type { UiLocale, MessageKey, Translator };
