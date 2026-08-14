import { t as t_dev_or_prod } from './i18n.js';
import type { t as t_dev } from './i18n-dev.js';

export const t = t_dev_or_prod as unknown as typeof t_dev;

// UI 文言のランタイム解決（U18）。`t` はブラウザ UI 言語のみを見る manifest 系統、
// 以下はユーザー設定（`UserSettings.locale`）に追従する UI 系統。
export * from './runtime.js';
export * from './react.js';
