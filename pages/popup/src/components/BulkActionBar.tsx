import { useI18n } from '@extension/i18n';

interface BulkActionBarProps {
  /** 選択件数（1件以上のときのみ描画される想定）。 */
  count: number;
  /** [移動] ボタン（一括移動用の MovePanel を開く）。 */
  onMove: () => void;
  /** [削除] ボタン（一括削除・1アンドゥ単位）。 */
  onDelete: () => void;
  /**
   * [選択解除] ボタン。`selection-mode` 以降、Popup は `exitSelectionMode` を渡す＝**選択解除と同時に
   * 選択モードも終了**し、行クリックが「開く」に戻る（終了導線をトグルボタン・Escape とここの3つに揃える）。
   */
  onClear: () => void;
}

/**
 * 一括操作バー（U13・デザイン状態1f）。1件以上選択中は `SearchHeader` の代わりにこれを描画する
 * （Popup 側で `selection.count > 0` により差し替える。同じ56px枠を占有する）。
 * 選択モード中でも**選択0件の間は `SearchHeader` のまま**であり、検索し直して選び直せる（`selection-mode`）。
 *
 * docs/design/README.md「1f — 複数選択中（一括操作バー）」の視覚仕様に準拠:
 * bg `accent-bg` + 下ボーダー、左に「N件選択中」、右に [移動](accent塗り) / [削除](危険色枠) / [選択解除](テキスト)。
 */
export const BulkActionBar = ({ count, onMove, onDelete, onClear }: BulkActionBarProps) => {
  const { t } = useI18n();

  return (
    <header className="bg-accent-bg flex h-14 flex-none items-center justify-between border-b border-[#DCE1F8] px-[14px]">
      <span className="text-accent-bar text-[13px] font-bold">{t('popupBulkSelected', String(count))}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMove}
          className="bg-accent flex h-[30px] items-center rounded-md px-3 text-[12px] font-bold text-white">
          {t('commonMove')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="border-danger-border text-danger flex h-[30px] items-center rounded-md border bg-white px-3 text-[12px] font-bold">
          {t('commonDelete')}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="text-ink-soft flex h-[30px] items-center rounded-md px-2 text-[12px] font-medium">
          {t('commonDeselect')}
        </button>
      </div>
    </header>
  );
};
