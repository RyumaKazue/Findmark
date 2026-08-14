import type { MessageKey } from '@extension/i18n';

/**
 * 翻訳前のメッセージ（U18）。
 *
 * 純粋モデル（`resultMetaModel` / `inlineEditModel` 等）は表示済みの文字列ではなく**メッセージキーと置換値**を
 * 返し、UI 層が `useI18n().t(key, substitutions)` で文字列化する。これにより、ロケール非依存のロジックが
 * 文言に依存せず、ユニットテストも文言変更で壊れなくなる。
 */
interface LocalizedMessage {
  key: MessageKey;
  /** `$1`, `$2`, ... に対応する置換値（数値は呼び出し側で文字列化する）。 */
  substitutions?: string[];
}

export type { LocalizedMessage };
