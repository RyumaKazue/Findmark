import 'webextension-polyfill';
import { runStartupCleanup } from './cleanup.js';
import { syncShortcutAvailability } from './commands.js';
import { aliasStore, bookmarkService, localStateStore, normalizer, settingsStore, trashStore } from './services.js';

/**
 * Findmark の Service Worker（U17）。
 *
 * 責務は architecture.md「背景(Service Worker)」の通り、**ブラウザ起動時の掃除**と
 * **起動ショートカットの割り当て確認**のみ。検索・編集は Popup の UI スレッドで完結させ、
 * ここにドメインロジックは持たせない（MV3 のため常駐しない）。
 */

/** クリーンアップ本体へ渡す実体（`CleanupDeps` の最小契約を満たす）。 */
const cleanupDeps = {
  bookmarks: bookmarkService,
  aliases: aliasStore,
  localState: localStateStore,
  settings: settingsStore,
  trash: trashStore,
  normalizer,
};

const shortcutDeps = {
  // `chrome.commands` は manifest の `commands` キーで利用可能（追加の permission は不要）。
  commands: { getAll: () => globalThis.chrome.commands.getAll() },
  localState: localStateStore,
};

/** 起動時に実行する一連の処理。個々の失敗は内部で捕捉されるため、ここでは待つだけでよい。 */
const runStartupTasks = async (): Promise<void> => {
  await Promise.all([runStartupCleanup(cleanupDeps), syncShortcutAvailability(shortcutDeps)]);
};

// リスナー登録は必ずトップレベルで同期的に行う。MV3 の SW は停止・再起動を繰り返し、起動のたびに
// このファイルが再評価されるため、非同期処理の後に登録するとイベントを取りこぼす。
chrome.runtime.onStartup.addListener(() => {
  void runStartupTasks();
});

// インストール/更新直後も同様に掃除する（更新でデータ構造が変わった場合の追従と、初回の
// ショートカット割り当て確認を兼ねる。PRD「起動ショートカットの割り当て」）。
chrome.runtime.onInstalled.addListener(() => {
  void runStartupTasks();
});
