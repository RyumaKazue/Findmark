import { useI18n } from '@extension/i18n';
import { cn } from '@extension/ui';
import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Popup の document リスナーから呼ばれるダイアログ操作（`panel:*` インテントの実行体）。
 * `MovePanel`/`ContextMenu` と同じ命令ハンドル方式。
 */
interface ConfirmDialogActions {
  /** `panel:candidate-up` / `←`。フォーカスを1つ前のボタンへ。 */
  selectPrev: () => void;
  /** `panel:candidate-down` / `→`。フォーカスを1つ後のボタンへ。 */
  selectNext: () => void;
  /** `panel:confirm`。**フォーカス中のボタン**を実行する（既定はキャンセル）。 */
  confirm: () => void;
  /** `panel:close`。キャンセルして閉じる。 */
  close: () => void;
}

interface ConfirmDialogProps {
  /** 見出し（例: 「"chrome" を削除します」）。 */
  title: string;
  /** 本文（例: 「中のブックマーク 12 件・フォルダ 3 件も一緒に削除されます。」）。 */
  message: string;
  /** 実行ボタンのラベル（例: 「削除する」）。 */
  confirmLabel: string;
  /** 実行が破壊的か（危険色で表示する）。 */
  danger?: boolean;
  /** 実行。 */
  onConfirm: () => void;
  /** キャンセル（Escape / 背景クリック / [キャンセル]）。 */
  onCancel: () => void;
  /** キーボードインテントを受け取るための命令ハンドル。 */
  actionsRef: RefObject<ConfirmDialogActions | null>;
}

/** ボタンの並び。**キャンセルを先頭に置き、既定フォーカスにする**（破壊的操作の誤発火を防ぐ）。 */
const CANCEL_INDEX = 0;
const CONFIRM_INDEX = 1;

/**
 * 汎用の確認ダイアログ（`folder-delete` で導入・PANEL モード）。
 *
 * フォルダ削除固有の文言は持たず、呼び出し側が渡す（ゴミ箱を空にする等、他の破壊的操作でも使い回せる）。
 *
 * **既定フォーカスは [キャンセル]**。ポップアップは `Enter` を多用する UI（検索結果を開く・パネルの決定）で
 * あり、確認の意味を理解する前に `Enter` を押してしまう経路が現実的にある。既定を破壊側に置かないことで、
 * 「うっかり `Enter`」がフォルダ丸ごとの削除にならないようにする。
 *
 * キー操作は Popup の document リスナーが `PANEL` インテントとして解決する（`↑↓`＝ボタン移動・
 * `Enter`＝フォーカス中のボタンを実行・`Escape`＝キャンセル）。横並びのボタン列のため `←→` も
 * 同じ移動として扱う（この振り分けは Popup 側が行う）。
 */
export const ConfirmDialog = ({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
  actionsRef,
}: ConfirmDialogProps) => {
  const { t } = useI18n();
  const [index, setIndex] = useState(CANCEL_INDEX);

  const selectPrev = useCallback(() => setIndex(i => Math.max(CANCEL_INDEX, i - 1)), []);
  const selectNext = useCallback(() => setIndex(i => Math.min(CONFIRM_INDEX, i + 1)), []);
  const confirm = useCallback(() => {
    if (index === CONFIRM_INDEX) {
      onConfirm();
    } else {
      onCancel();
    }
  }, [index, onConfirm, onCancel]);

  useEffect(() => {
    actionsRef.current = { selectPrev, selectNext, confirm, close: onCancel };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, selectPrev, selectNext, confirm, onCancel]);

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center pt-20">
      {/* 背景オーバーレイ（クリックでキャンセル）。破壊的操作のため暗幕を張り、他の操作を遮る。
          右クリックは**何も起こさない**（既定メニューの抑止は Popup の document リスナーが担う）。
          メニューと違って右クリックで閉じないのは、確認を求めている最中に誤操作で消えないようにするため。 */}
      <button
        type="button"
        aria-label={t('commonCancel')}
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/20"
      />
      <div
        role="alertdialog"
        aria-label={title}
        className="shadow-shell border-line relative flex w-[400px] flex-col gap-3 rounded-lg border bg-white p-4">
        <div className="flex flex-col gap-1.5">
          <p className="text-ink text-[13.5px] font-bold">{title}</p>
          <p className="text-ink-soft text-[12.5px] leading-relaxed">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={e => e.preventDefault()}
            onMouseMove={() => setIndex(CANCEL_INDEX)}
            onClick={onCancel}
            className={cn(
              'border-line text-ink-soft flex h-[30px] cursor-pointer items-center rounded-md border bg-white px-3 text-[12px] font-bold',
              index === CANCEL_INDEX && 'ring-accent ring-2',
            )}>
            {t('commonCancel')}
          </button>
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={e => e.preventDefault()}
            onMouseMove={() => setIndex(CONFIRM_INDEX)}
            onClick={onConfirm}
            className={cn(
              'flex h-[30px] cursor-pointer items-center rounded-md px-3 text-[12px] font-bold text-white',
              danger ? 'bg-danger' : 'bg-accent',
              index === CONFIRM_INDEX && 'ring-accent ring-2 ring-offset-1',
            )}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export type { ConfirmDialogActions };
