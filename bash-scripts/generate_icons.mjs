#!/usr/bin/env node
/**
 * 拡張アイコン（PNG）を生成するスクリプト（U18 release-prep）。
 *
 * 生成元は `chrome-extension/icons/icon.svg`。ローカルの Chrome を headless で起動し、
 * SVG を各サイズで描画してスクリーンショットを撮る方式にしている:
 * - 外部サービスへ画像を送らない（PRD「外部通信ゼロ」の方針と整合する）
 * - 画像変換ライブラリ（sharp 等のネイティブ依存）を追加しない
 * - 生成結果は Git 管理下に置くため、CI に Chrome を要求しない
 *
 * 使い方:
 *   node bash-scripts/generate_icons.mjs
 *   CHROME_BIN=/path/to/chrome node bash-scripts/generate_icons.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 生成元の SVG は `public/` に置かない（`public/` は丸ごと dist へコピーされ、manifest が参照しない
// ファイルまで提出 zip に入ってしまうため）。
const SVG_PATH = resolve(ROOT, 'chrome-extension/icons/icon.svg');
const OUT_DIR = resolve(ROOT, 'chrome-extension/public');
/** manifest の `icons` / `action.default_icon` が参照するサイズ。 */
const SIZES = [16, 32, 48, 128];

/** Chrome の実行ファイルを探す（`CHROME_BIN` で上書き可能）。 */
const findChrome = () => {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) {
    throw new Error(
      'Chrome が見つかりません。`CHROME_BIN=/path/to/chrome node bash-scripts/generate_icons.mjs` のように指定してください。',
    );
  }
  return found;
};

/** SVG を指定サイズちょうどに配置する最小の HTML（余白・スクロールバーを持たせない）。 */
const buildHtml = (svg, size) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`;

const main = () => {
  if (!existsSync(SVG_PATH)) {
    throw new Error(`生成元の SVG が見つかりません: ${SVG_PATH}`);
  }

  const chrome = findChrome();
  const svg = readFileSync(SVG_PATH, 'utf-8');
  const workDir = mkdtempSync(resolve(tmpdir(), 'findmark-icons-'));

  try {
    for (const size of SIZES) {
      const htmlPath = resolve(workDir, `icon-${size}.html`);
      const outPath = resolve(OUT_DIR, `icon-${size}.png`);
      writeFileSync(htmlPath, buildHtml(svg, size), 'utf-8');

      execFileSync(
        chrome,
        [
          '--headless',
          '--disable-gpu',
          '--hide-scrollbars',
          '--force-device-scale-factor=1',
          '--default-background-color=00000000',
          `--window-size=${size},${size}`,
          `--screenshot=${outPath}`,
          `file://${htmlPath}`,
        ],
        { stdio: 'ignore' },
      );

      if (!existsSync(outPath)) {
        throw new Error(`アイコンの生成に失敗しました: ${outPath}`);
      }
      console.log(`generated: ${outPath}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
};

main();
