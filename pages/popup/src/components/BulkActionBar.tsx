interface BulkActionBarProps {
  /** 選択件数（1件以上のときのみ描画される想定）。 */
  count: number;
  /** [移動] ボタン（一括移動用の MovePanel を開く）。 */
  onMove: () => void;
  /** [削除] ボタン（一括削除・1アンドゥ単位）。 */
  onDelete: () => void;
  /** [選択解除] ボタン。 */
  onClear: () => void;
}

/**
 * 一括操作バー（U13・デザイン状態1f）。1件以上選択中は `SearchHeader` の代わりにこれを描画する
 * （Popup 側で `selection.count > 0` により差し替える。同じ56px枠を占有する）。
 *
 * docs/design/README.md「1f — 複数選択中（一括操作バー）」の視覚仕様に準拠:
 * bg `accent-bg` + 下ボーダー、左に「N件選択中」、右に [移動](accent塗り) / [削除](危険色枠) / [選択解除](テキスト)。
 */
export const BulkActionBar = ({ count, onMove, onDelete, onClear }: BulkActionBarProps) => (
  <header className="bg-accent-bg flex h-14 flex-none items-center justify-between border-b border-[#DCE1F8] px-[14px]">
    <span className="text-accent-bar text-[13px] font-bold">{count}件選択中</span>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onMove}
        className="bg-accent flex h-[30px] items-center rounded-md px-3 text-[12px] font-bold text-white">
        移動
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="border-danger-border text-danger flex h-[30px] items-center rounded-md border bg-white px-3 text-[12px] font-bold">
        削除
      </button>
      <button
        type="button"
        onClick={onClear}
        className="text-ink-soft flex h-[30px] items-center rounded-md px-2 text-[12px] font-medium">
        選択解除
      </button>
    </div>
  </header>
);
