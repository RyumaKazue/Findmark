/**
 * 起動ショートカット（manifest の `commands._execute_action`）の割り当て検証（U17）。
 *
 * `suggested_key`（`Ctrl+Shift+F` / mac `Command+Shift+F`）は**希望**でしかなく、他拡張が先に同じ
 * 組み合わせを取得している場合、Chrome はエラーも通知も出さずに**未割り当てのまま**インストールする。
 * キーボード完結を掲げる本プロダクトで「起動キーが効かない」ことにユーザーが気づけないのは致命的なため
 * （PRD「起動ショートカットの割り当て」）、Service Worker が実際の割り当て状態を確認して記録し、
 * Options 側が案内（`chrome://extensions/shortcuts`）を表示する。
 *
 * なお `_execute_action` は Chrome の予約コマンドで、押下時はブラウザが直接ポップアップを開き
 * `chrome.commands.onCommand` には配信されない。したがって「ショートカットで popup 起動」の実体は
 * manifest 側（U1 で定義済み）が担い、本モジュールはその有効性の検証のみを担当する。
 */

/** ポップアップ起動に割り当てられる予約コマンド名。 */
const ACTION_COMMAND = '_execute_action';

/** `chrome.commands` の最小契約（テストではモックを注入する）。 */
interface CommandsGateway {
  getAll(): Promise<{ name?: string; shortcut?: string }[]>;
}

/**
 * 割り当て状態の書き込み先（データレイヤーの最小契約）。
 * 「現在値と同じなら書き込まない」ガードは `localStateStore.setShortcutUnassigned` 側が持つため、
 * ここでは読み出しを要求しない。
 */
interface ShortcutStateGateway {
  setShortcutUnassigned(unassigned: boolean): Promise<void>;
}

interface ShortcutDeps {
  commands: CommandsGateway;
  localState: ShortcutStateGateway;
}

/**
 * `_execute_action` の割り当て状態を検証し、`LocalState.isShortcutUnassigned` に反映する。
 *
 * ユーザーが後から `chrome://extensions/shortcuts` で割り当てた場合も、次回起動時にこの検証が
 * `false` へ戻すため案内は自動的に消える。
 */
const syncShortcutAvailability = async (deps: ShortcutDeps): Promise<void> => {
  try {
    const commands = await deps.commands.getAll();
    const action = commands.find(command => command.name === ACTION_COMMAND);
    // コマンド自体が見つからない場合も「起動キーが使えない」ことに変わりはないため未割り当て扱いにする。
    const unassigned = !action?.shortcut;

    await deps.localState.setShortcutUnassigned(unassigned);
  } catch (e) {
    // Service Worker のイベントハンドラが最上位のため伝播先が無い。ログに残して次回起動に委ねる。
    console.error('[background] 起動ショートカットの割り当て確認に失敗しました:', e);
  }
};

export { ACTION_COMMAND, syncShortcutAvailability };
export type { CommandsGateway, ShortcutDeps, ShortcutStateGateway };
