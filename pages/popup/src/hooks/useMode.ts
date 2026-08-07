import { initialModeState, modeReducer, resolveKeyIntent } from './modeMachine.js';
import { useCallback, useReducer } from 'react';
import type { KeyIntent, KeyLike, ListFocus, Mode } from './modeMachine.js';

export interface UseModeApi {
  /** 現在のモード（既定 LIST）。 */
  mode: Mode;
  /** 編集/操作対象の行 ID（LIST/FOLDER_TREE/DRAG では null 可）。 */
  targetId: string | null;
  /** 左ペイン（フォルダツリー）へ入る（実ナビゲーションの結線は U11。U8a はモード遷移のみ提供）。 */
  enterFolderTree: () => void;
  /** インライン編集（リネーム/URL）へ入る（UI 実体は U10）。 */
  enterInlineEdit: (targetId: string) => void;
  /** 別名チップ編集へ入る（UI 実体は U9）。 */
  enterAliasEdit: (targetId: string) => void;
  /** フォルダ選択パネルへ入る（UI 実体は U12）。 */
  enterPanel: () => void;
  /** ドラッグ&ドロップへ入る（UI 実体は U12）。 */
  enterDrag: (targetId?: string | null) => void;
  /** 現在のモードを終了し LIST に戻る。 */
  exitToList: () => void;
  /**
   * 現在モードでのキー→インテント解決（`resolveKeyIntent` を現在モードに束ねたもの）。
   * `listFocus`（LIST モード内の検索ボックス/右ペインの別）は呼び出し側（Popup）が渡す。DOM フォーカスの
   * 操作（`focus()`/`blur()`）と密結合するため、`listFocus` 自体は本フックの state に持たない（design.md 参照）。
   */
  resolveKey: (e: KeyLike, listFocus: ListFocus) => KeyIntent;
}

/**
 * Popup のモード状態機械を React へ橋渡しするフック（U8。U8a でフォーカス3状態対応を追加）。
 *
 * 純粋ロジックは `modeMachine.ts` に集約し、本フックは `useReducer` で state を保持し、遷移コールバックと
 * 現在モードに束ねたキー解決を公開するだけの薄い層にする。後続単位（U9/U10/U11/U12/U13）は enter 系 / exitToList で
 * モードに出入りし、`resolveKey` の返すインテントに応答する。
 */
export const useMode = (initialMode: Mode = 'LIST'): UseModeApi => {
  // 初期モードを差し替え可能にする（U11: 起動時の既定フォーカスを左ペイン = 'FOLDER_TREE' にする）。
  // 遷移規則自体は `modeMachine` の `modeReducer` を変更しない（初期 state のみ上書き）。
  const [state, dispatch] = useReducer(modeReducer, { ...initialModeState, mode: initialMode });

  const enterFolderTree = useCallback(() => dispatch({ type: 'ENTER_FOLDER_TREE' }), []);
  const enterInlineEdit = useCallback((targetId: string) => dispatch({ type: 'ENTER_INLINE_EDIT', targetId }), []);
  const enterAliasEdit = useCallback((targetId: string) => dispatch({ type: 'ENTER_ALIAS_EDIT', targetId }), []);
  const enterPanel = useCallback(() => dispatch({ type: 'ENTER_PANEL' }), []);
  const enterDrag = useCallback((targetId: string | null = null) => dispatch({ type: 'ENTER_DRAG', targetId }), []);
  const exitToList = useCallback(() => dispatch({ type: 'EXIT_TO_LIST' }), []);
  const resolveKey = useCallback(
    (e: KeyLike, listFocus: ListFocus) => resolveKeyIntent(state.mode, e, listFocus),
    [state.mode],
  );

  return {
    mode: state.mode,
    targetId: state.targetId,
    enterFolderTree,
    enterInlineEdit,
    enterAliasEdit,
    enterPanel,
    enterDrag,
    exitToList,
    resolveKey,
  };
};
