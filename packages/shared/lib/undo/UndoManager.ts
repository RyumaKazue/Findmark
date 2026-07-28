/**
 * 削除・移動・一括操作を1単位のアンドゥ可能アクションとして保持する即時アンドゥ（メモリ・5秒）。
 *
 * chrome API・React・DOM に依存しない純粋クラスとして単体テスト可能に保つ
 * （architecture.md のレイヤー依存 UI→サービス→データ）。UI は `subscribe` で保持状態を購読し、
 * トースト表示・`Ctrl/Cmd+Z` からの `undoLatest` 呼び出しを行う（U10）。
 */

/** アンドゥ可能な1アクション。`expiresAt` を過ぎると `undoLatest` は実行しない。 */
interface UndoableAction {
  /** トースト文言（例:「◯◯」を削除しました）。 */
  label: string;
  undo(): Promise<void>;
  /** アンドゥ可能な期限（epoch ms）。 */
  expiresAt: number;
}

/** 即時アンドゥの保持期間（5秒。functional-design「UndoManager(即時アンドゥ)」）。 */
const UNDO_WINDOW_MS = 5000;

type Listener = (action: UndoableAction | null) => void;

/**
 * 直近1件のみを保持する即時アンドゥ管理。
 *
 * - 保持は1件のみ。`register` は直前のアクションを置き換える（多段アンドゥは持たない）。
 * - 期限は `setTimeout` の自動破棄と `undoLatest` 実行時の `Date.now()` 再チェックの二重で守る
 *   （バックグラウンドタブでの setTimeout スロットリングにより、タイマーだけでは期限切れの
 *   アクションが実行されてしまう可能性があるため）。
 */
class UndoManager {
  private current: UndoableAction | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<Listener>();

  /** 直前のアクションを置き換えて登録する。期限到達で自動的に破棄される。 */
  register(action: UndoableAction): void {
    this.clearTimer();
    this.current = action;
    this.notify();
    const delay = Math.max(0, action.expiresAt - Date.now());
    this.timer = setTimeout(() => {
      // 登録後に別アクションへ差し替わっていた場合は何もしない（このタイマーは古い）。
      if (this.current === action) {
        this.current = null;
        this.notify();
      }
    }, delay);
  }

  /**
   * 保持中のアクションを1回だけ実行する。期限切れ・未登録なら何もしない。
   * `undo()` が reject しても保持は解除する（同じ失敗するアンドゥの再試行を防ぐ）。
   */
  async undoLatest(): Promise<void> {
    const action = this.current;
    if (!action || Date.now() > action.expiresAt) {
      return;
    }
    this.clearTimer();
    this.current = null;
    this.notify();
    try {
      await action.undo();
    } catch (e) {
      console.error('[UndoManager] アンドゥの実行に失敗しました:', e);
    }
  }

  /** 現在保持中のアクション（期限切れ判定はしない生の値）。 */
  peek(): UndoableAction | null {
    return this.current;
  }

  /** トーストを閉じる＝アンドゥ機会の放棄。保持を解除する。 */
  dismiss(): void {
    if (this.current === null) {
      return;
    }
    this.clearTimer();
    this.current = null;
    this.notify();
  }

  /** 保持状態の変化を購読する。購読時に現在値を1度通知する。解除関数を返す。 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.current);
    }
  }
}

export { UndoManager, UNDO_WINDOW_MS };
export type { UndoableAction };
