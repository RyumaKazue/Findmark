import { UNDO_WINDOW_MS } from '@extension/shared';
import { undoManager } from '@src/services';
import { useCallback, useEffect, useState } from 'react';
import type { UndoableAction } from '@extension/shared';

export interface UseUndoApi {
  /** 表示中のアンドゥ対象（`null` ならトーストを表示しない）。 */
  pending: UndoableAction | null;
  /** アンドゥアクションを登録する（`expiresAt` は内部で `UNDO_WINDOW_MS` 後に付与する）。 */
  register: (label: string, undo: () => Promise<void>) => void;
  /** 保持中のアクションを実行する（期限切れ・未登録なら何もしない）。 */
  undoLatest: () => void;
  /** トーストを閉じる（アンドゥ機会の放棄）。 */
  dismiss: () => void;
}

/**
 * `UndoManager`（サービスレイヤー・U10）を React state へ橋渡しするフック。
 *
 * `services.ts` のモジュールスコープ単一インスタンス `undoManager` を購読するだけの薄い層にし、
 * 削除・削除アンドゥ・（将来の）移動・一括操作の各処理は `useRowActions` 等の呼び出し側が担う。
 */
export const useUndo = (): UseUndoApi => {
  const [pending, setPending] = useState<UndoableAction | null>(null);

  useEffect(() => undoManager.subscribe(setPending), []);

  const register = useCallback((label: string, undo: () => Promise<void>) => {
    undoManager.register({ label, undo, expiresAt: Date.now() + UNDO_WINDOW_MS });
  }, []);

  // UndoManager.undoLatest は内部で undo() の失敗を握り潰し console.error に残すため reject しない。
  const undoLatest = useCallback(() => {
    void undoManager.undoLatest();
  }, []);

  const dismiss = useCallback(() => {
    undoManager.dismiss();
  }, []);

  return { pending, register, undoLatest, dismiss };
};
