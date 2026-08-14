import { readFileSync } from 'node:fs';
import type { ManifestType } from '@extension/shared';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

/**
 * Findmark の manifest（U1 で最小権限へ是正、U18 でストア提出用に整備）。
 *
 * @prop default_locale
 * 既定は日本語（PRD「互換性 / 国際化」）。`__MSG_*` は `_locales/{ja,en}/messages.json` から
 * Chrome が解決する（ポップアップ/オプションの UI 文言はユーザー設定に追従する別系統・U18）。
 *
 * @prop permissions
 * `bookmarks` / `storage` / `activeTab` / `favicon` の4つのみ。host permission は要求しない
 * （PRD「セキュリティ / プライバシー」）。
 *
 * @prop icons
 * 生成元は `icons/icon.svg`（`public/` は dist へ丸ごとコピーされるため生成元は置かない）。PNG は `bash-scripts/generate_icons.mjs` で再生成する。
 *
 * MVP は Chrome 専用のため Firefox 向けの `browser_specific_settings` は持たない
 * （docs/mvp-development-flow.md「スコープ外」）。
 */
const manifest = {
  manifest_version: 3,
  default_locale: 'ja',
  name: '__MSG_extensionName__',
  version: packageJson.version,
  description: '__MSG_extensionDescription__',
  permissions: ['bookmarks', 'storage', 'activeTab', 'favicon'],
  options_page: 'options/index.html',
  background: {
    service_worker: 'background.js',
    type: 'module',
  },
  action: {
    default_popup: 'popup/index.html',
    default_icon: {
      '16': 'icon-16.png',
      '32': 'icon-32.png',
      '48': 'icon-48.png',
      '128': 'icon-128.png',
    },
  },
  icons: {
    '16': 'icon-16.png',
    '32': 'icon-32.png',
    '48': 'icon-48.png',
    '128': 'icon-128.png',
  },
  commands: {
    _execute_action: {
      suggested_key: {
        default: 'Ctrl+Shift+F',
        mac: 'Command+Shift+F',
      },
      description: '__MSG_commandOpenPopup__',
    },
  },
} satisfies ManifestType;

export default manifest;
