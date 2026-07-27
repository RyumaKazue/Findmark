import { initialModeState, modeReducer, resolveKeyIntent } from './modeMachine.js';
import { useCallback, useReducer } from 'react';
import type { KeyIntent, KeyLike, Mode } from './modeMachine.js';

export interface UseModeApi {
  /** 現在のモード（既定 LIST）。 */
  mode: Mode;
  /** 編集/操作対象の行 ID（LIST/DRAG では null 可）。 */
  targetId: string | null;
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
  /** 現在モードでのキー→インテント解決（`resolveKeyIntent` を現在モードに束ねたもの）。 */
  resolveKey: (e: KeyLike) => KeyIntent;
}

/**
 * Popup のモード状態機械を React へ橋渡しするフック（U8）。
 *
 * 純粋ロジックは `modeMachine.ts` に集約し、本フックは `useReducer` で state を保持し、遷移コールバックと
 * 現在モードに束ねたキー解決を公開するだけの薄い層にする。後続単位（U9/U10/U12/U13）は enter 系 / exitToList で
 * モードに出入りし、`resolveKey` の返すインテントに応答する。
 */
export const useMode = (): UseModeApi => {
  const [state, dispatch] = useReducer(modeReducer, initialModeState);

  const enterInlineEdit = useCallback((targetId: string) => dispatch({ type: 'ENTER_INLINE_EDIT', targetId }), []);
  const enterAliasEdit = useCallback((targetId: string) => dispatch({ type: 'ENTER_ALIAS_EDIT', targetId }), []);
  const enterPanel = useCallback(() => dispatch({ type: 'ENTER_PANEL' }), []);
  const enterDrag = useCallback((targetId: string | null = null) => dispatch({ type: 'ENTER_DRAG', targetId }), []);
  const exitToList = useCallback(() => dispatch({ type: 'EXIT_TO_LIST' }), []);
  const resolveKey = useCallback((e: KeyLike) => resolveKeyIntent(state.mode, e), [state.mode]);

  return {
    mode: state.mode,
    targetId: state.targetId,
    enterInlineEdit,
    enterAliasEdit,
    enterPanel,
    enterDrag,
    exitToList,
    resolveKey,
  };
};
