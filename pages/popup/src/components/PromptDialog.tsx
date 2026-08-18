import { useI18n } from '@extension/i18n';
import { cn } from '@extension/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

/**
 * Popup の document リスナーから呼ばれるダイアログ操作（`panel:*` インテントの実行体）。
 *
 * `ConfirmDialogActions` と違い**候補移動（`selectPrev`/`selectNext`）を持たない**。対象が1行のテキスト入力
 * なので `↑↓`/`←→` で動かす候補が存在せず、意味の無いハンドルを空実装で埋めないため。Popup 側は
 * `folder-prompt` のとき矢印キーを何にも割り当てない（入力欄内のカーソル移動はブラウザ既定に任せる）。
 */
interface PromptDialogActions {
  /** `panel:confirm`。入力値で確定する（空・空白のみなら何もしない）。 */
  confirm: () => void;
  /** `panel:close`。取りやめる。 */
  close: () => void;
}

interface PromptDialogProps {
  /** 見出し（例: 「"開発" の中に新しいフォルダを作成」）。 */
  title: string;
  /** 入力欄のラベル（`aria-label` と placeholder に使う）。 */
  inputLabel: string;
  /** 入力欄の初期値（新規作成なら空文字）。 */
  initialValue: string;
  /** マウント時に初期値を全選択するか（名前変更は書き換えが主用途のため true）。 */
  selectOnFocus?: boolean;
  /** 確定ボタンのラベル（例: 「作成」「保存」）。 */
  confirmLabel: string;
  /** 確定。**トリムされていない生の値**を渡す（トリムと検証の責務は呼び出し側の純粋モデルに置く）。 */
  onConfirm: (value: string) => void;
  /** 取りやめ（Escape / 背景クリック / [キャンセル]）。 */
  onCancel: () => void;
  /** キーボードインテントを受け取るための命令ハンドル。 */
  actionsRef: RefObject<PromptDialogActions | null>;
}

/**
 * 汎用の1行入力ダイアログ（`folder-rename-create` で導入・PANEL モード）。
 *
 * フォルダ固有の文言・検証を持たず、見出し / ラベル / 初期値 / 確定ラベルをすべて呼び出し側から受ける
 * （`ConfirmDialog` と同じ規律。他の「1行入力して確定する」操作へ再利用できる）。
 *
 * **キー処理は入力欄自身が拾って `stopPropagation` する**（`InlineEdit`/`AliasEditor` と同じ規律）。
 * document リスナーへ素通しすると、日本語入力の**変換確定 `Enter`** がそのまま `panel:confirm` として解決され、
 * 変換を確定しただけでダイアログが閉じてしまう。`isComposing` を見て変換中の `Enter` は無視する。
 * `actionsRef` は入力欄に DOM フォーカスが無い経路（背景をクリックした直後など）の保険として公開する
 * （入力欄で処理したイベントは伝播を止めているため、二重発火は起きない）。
 */
export const PromptDialog = ({
  title,
  inputLabel,
  initialValue,
  selectOnFocus = false,
  confirmLabel,
  onConfirm,
  onCancel,
  actionsRef,
}: PromptDialogProps) => {
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // 空・空白のみでは確定させない。フォルダ名固有の検証（`folderMenuModel.validateFolderTitle`）ではなく
  // 汎用の空判定にとどめる（本コンポーネントは対象の種類を知らない）。
  const canConfirm = value.trim().length > 0;

  const confirm = useCallback(() => {
    if (!canConfirm) {
      return;
    }
    onConfirm(value);
  }, [canConfirm, onConfirm, value]);

  // マウント時に入力欄へフォーカス（名前変更は既存値を全選択して、すぐ書き換えられるようにする）。
  useEffect(() => {
    inputRef.current?.focus();
    if (selectOnFocus) {
      inputRef.current?.select();
    }
  }, [selectOnFocus]);

  useEffect(() => {
    actionsRef.current = { confirm, close: onCancel };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, confirm, onCancel]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // 変換中の Enter は「変換の確定」であってダイアログの確定ではない。ここで抜けないと、
    // 日本語でフォルダ名を打った瞬間に確定してしまう。
    if (e.nativeEvent.isComposing) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      confirm();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center pt-20">
      {/* 背景オーバーレイ（クリックで取りやめ）。`ConfirmDialog` と同じく暗幕を張り、入力中に背後の行を
          誤操作できないようにする。右クリックでは閉じない（入力中の誤操作で消えないため）。 */}
      <button
        type="button"
        aria-label={t('commonCancel')}
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/20"
      />
      <div
        role="dialog"
        aria-label={title}
        className="shadow-shell border-line relative flex w-[400px] flex-col gap-3 rounded-lg border bg-white p-4">
        <p className="text-ink text-[13.5px] font-bold">{title}</p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={inputLabel}
          placeholder={inputLabel}
          className="border-accent shadow-focus-ring text-ink h-[34px] w-full rounded-md border-[1.5px] bg-white px-2.5 text-[13px] font-medium outline-none"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={e => e.preventDefault()}
            onClick={onCancel}
            className="border-line text-ink-soft flex h-[30px] cursor-pointer items-center rounded-md border bg-white px-3 text-[12px] font-bold">
            {t('commonCancel')}
          </button>
          <button
            type="button"
            tabIndex={-1}
            disabled={!canConfirm}
            // 入力欄からフォーカスを奪わない（押した後もそのまま打ち続けられる。行内ボタンと同じ規律）。
            onMouseDown={e => e.preventDefault()}
            onClick={confirm}
            className={cn(
              'flex h-[30px] items-center rounded-md px-3 text-[12px] font-bold text-white',
              canConfirm ? 'bg-accent cursor-pointer' : 'bg-accent/40 cursor-not-allowed',
            )}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export type { PromptDialogActions };
