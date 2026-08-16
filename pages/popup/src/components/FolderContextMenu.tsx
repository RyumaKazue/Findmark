import { useI18n } from '@extension/i18n';
import { cn } from '@extension/ui';
import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Popup の document リスナーから呼ばれるメニュー操作（`panel:*` インテントの実行体）。
 * `MovePanel`/`FolderTree` と同じ命令ハンドル方式（キー処理は document レベルで一元化する）。
 */
interface FolderContextMenuActions {
  /** `panel:candidate-up`。項目を1つ上へ。 */
  selectPrev: () => void;
  /** `panel:candidate-down`。項目を1つ下へ。 */
  selectNext: () => void;
  /** `panel:confirm`。現在の項目を実行する（無効項目なら何もしない）。 */
  confirm: () => void;
  /** `panel:close`。メニューを閉じる。 */
  close: () => void;
}

/** メニュー項目1件。将来のフォルダ操作（リネーム・新規作成）を足せるよう配列駆動にしている。 */
interface FolderMenuItem {
  /** 実行時に `onSelect` へ渡す識別子。 */
  key: string;
  /** 表示ラベル（呼び出し側が翻訳済みの文字列を渡す）。 */
  label: string;
  /** 破壊的操作か（危険色で表示する）。 */
  danger?: boolean;
  /** 選べない項目か（フォーカスはできるが実行されない）。 */
  disabled?: boolean;
  /** 無効な理由（ツールチップ）。 */
  disabledHint?: string;
}

interface FolderContextMenuProps {
  /** 右クリック位置（ビューポート座標）。 */
  x: number;
  y: number;
  items: FolderMenuItem[];
  /** 項目の実行。 */
  onSelect: (key: string) => void;
  /** メニューを閉じる（Escape / 背景クリック）。 */
  onClose: () => void;
  /** キーボードインテントを受け取るための命令ハンドル。 */
  actionsRef: RefObject<FolderContextMenuActions | null>;
}

/**
 * 「どの項目にもフォーカスが無い」状態（`folder-delete`）。
 *
 * メニューは**開いた直後に何も選ばれていない**状態から始める。先頭項目を初期選択にすると、カーソルが
 * 乗っていないのに選択済みに見え、項目が増えるほど「今どれが対象か」が紛らわしくなる（一般的な
 * コンテキストメニューも、ホバーするか矢印キーを押すまでは何も強調しない）。
 */
const NO_FOCUS = -1;

/** ポップアップの固定サイズ（docs/design「固定寸法」760×560）。メニューをこの内側へ収める。 */
const POPUP_WIDTH = 760;
const POPUP_HEIGHT = 560;
/** メニューの寸法（配置計算用の見積り。実寸は内容に依るが、はみ出し防止には上限で足りる）。 */
const MENU_WIDTH = 200;
const ITEM_HEIGHT = 32;
const MENU_PADDING = 8;

/**
 * 右クリック位置がポップアップ外へはみ出さないよう座標を丸める（純粋・本コンポーネント専用）。
 * 右端・下端では位置をずらして全体が見えるようにする。
 */
const clampPosition = (x: number, y: number, itemCount: number): { left: number; top: number } => {
  const height = itemCount * ITEM_HEIGHT + MENU_PADDING;
  return {
    left: Math.max(0, Math.min(x, POPUP_WIDTH - MENU_WIDTH)),
    top: Math.max(0, Math.min(y, POPUP_HEIGHT - height)),
  };
};

/**
 * フォルダ行の右クリックメニュー（`folder-delete`・PANEL モード）。
 *
 * `MovePanel` と同じ構成（背景オーバーレイ + 命令ハンドル）にし、キー操作（`↑↓`/`Enter`/`Escape`）は
 * Popup の document リスナーが `PANEL` インテントとして解決して `actionsRef` 経由で実行する。
 * これにより、DOM フォーカスが左ペインのツリールートにあってもキー操作が一貫して効く。
 *
 * 無効項目（最上位フォルダの削除など）はフォーカスできるが実行されない。理由を `title` で示し、
 * 「押せるのに何も起きない」ではなく「押せない理由が分かる」状態にする。
 */
export const FolderContextMenu = ({ x, y, items, onSelect, onClose, actionsRef }: FolderContextMenuProps) => {
  const { t } = useI18n();
  const [index, setIndex] = useState(NO_FOCUS);
  const { left, top } = clampPosition(x, y, items.length);

  const selectAt = useCallback(
    (i: number) => {
      const item = items[i];
      if (!item || item.disabled) {
        return;
      }
      onSelect(item.key);
    },
    [items, onSelect],
  );

  // 命令ハンドルを毎レンダー最新の closure で公開する（MovePanel と同方式）。
  // 未フォーカスからは `↑`=末尾 / `↓`=先頭 で入る（一般的なメニューの挙動）。以降は端でクランプする
  // （項目が少数のため循環させない。左ペインのツリーと同じ方針）。
  const selectPrev = useCallback(
    () => setIndex(i => (i === NO_FOCUS ? items.length - 1 : Math.max(0, i - 1))),
    [items.length],
  );
  const selectNext = useCallback(
    () => setIndex(i => (i === NO_FOCUS ? 0 : Math.min(items.length - 1, i + 1))),
    [items.length],
  );
  // 未フォーカスの `Enter` では何も実行しない（`selectAt(-1)` は `items[-1]` が undefined のため no-op）。
  const confirm = useCallback(() => selectAt(index), [selectAt, index]);
  useEffect(() => {
    actionsRef.current = { selectPrev, selectNext, confirm, close: onClose };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, selectPrev, selectNext, confirm, onClose]);

  return (
    <div className="absolute inset-0 z-30">
      {/* 背景オーバーレイ（クリックで閉じる）。メニューは暗幕を張らない（対象フォルダを見えたままにする）。
          **右クリックでも閉じる**: メニューを開いたまま別のフォルダを右クリックしたときに、まずこのメニューが
          閉じ、続く右クリックで新しい対象のメニューを開ける（既定メニューは Popup 側で抑止済み）。 */}
      <button
        type="button"
        aria-label={t('commonClose')}
        tabIndex={-1}
        onClick={onClose}
        onContextMenu={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        role="menu"
        // `role="menu"` はインタラクティブロールのため、ハンドラを持つ以上フォーカス可能である必要がある
        // （jsx-a11y）。実際のキー処理は Popup の document リスナーが担うので、DOM フォーカスは受け取らない
        // `-1` にする（メニュー内のボタンも同じ理由で `tabIndex={-1}`）。
        tabIndex={-1}
        // カーソルがメニューから離れたらハイライトを消す（「カーソルが乗っている項目」だけを強調する）。
        // キーボードで選んだ位置もここで解除されるが、マウスを動かした時点でキーボード操作は中断しており、
        // 見た目と操作対象が一致するほうが安全（`Enter` で意図しない項目を実行させない）。
        onMouseLeave={() => setIndex(NO_FOCUS)}
        style={{ left, top, width: MENU_WIDTH }}
        className="shadow-shell border-line absolute flex flex-col rounded-lg border bg-white py-1">
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            aria-disabled={item.disabled}
            title={item.disabled ? item.disabledHint : undefined}
            tabIndex={-1}
            onMouseDown={e => e.preventDefault()}
            onMouseMove={() => setIndex(i)}
            onClick={() => selectAt(i)}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]',
              item.disabled
                ? 'text-ink-faint cursor-not-allowed'
                : cn(
                    'cursor-pointer',
                    item.danger ? 'text-danger' : 'text-ink',
                    i === index && (item.danger ? 'bg-danger/10' : 'bg-accent-bg'),
                  ),
            )}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export type { FolderContextMenuActions, FolderMenuItem };
