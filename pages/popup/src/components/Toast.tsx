import { cn } from '@extension/ui';

interface ToastProps {
  message: string;
  /** アンドゥ等のアクションボタンのラベル（例:「元に戻す」）。省略時はボタンを描画しない。 */
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** `danger` はエラー通知（削除・アンドゥ失敗等）。既定は `default`（アンドゥ通知）。 */
  tone?: 'default' | 'danger';
}

/**
 * アンドゥ/エラートースト（U10）。PopupShell の下端中央に重ねて表示する。
 *
 * アンドゥのキーボード手段は `Ctrl/Cmd+Z`（document リスナー・Popup 側）で担保するため、
 * 本コンポーネントはフォーカスを奪わない（検索ボックスのフォーカスを維持する）。
 */
export const Toast = ({ message, actionLabel, onAction, onDismiss, tone = 'default' }: ToastProps) => (
  <div
    role="status"
    aria-live="polite"
    className={cn(
      'shadow-edit-row absolute inset-x-0 bottom-4 z-10 mx-auto flex w-fit max-w-[90%] items-center gap-3 rounded-md px-4 py-2.5',
      tone === 'danger' ? 'bg-danger text-white' : 'bg-ink text-white',
    )}>
    <span className="text-[12.5px] font-medium">{message}</span>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="flex-none text-[12.5px] font-bold text-white underline underline-offset-2">
        {actionLabel}
      </button>
    )}
    <button
      type="button"
      onClick={onDismiss}
      aria-label="閉じる"
      className="flex-none px-1 text-white/70 hover:text-white">
      ✕
    </button>
  </div>
);
