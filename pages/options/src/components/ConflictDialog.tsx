import { useState } from 'react';
import type { ConflictResolution } from '@extension/shared';

interface ConflictExisting {
  title: string;
  folderPath: string[];
}

interface ConflictIncoming {
  title: string;
  folderPath: string[];
}

interface ConflictDialogProps {
  /** 現在登録されている側（タイトル/フォルダ）。 */
  existing: ConflictExisting;
  /** インポートしようとしている側（タイトル/フォルダ）。 */
  incoming: ConflictIncoming;
  /**
   * 何件目の競合か（1始まり）。`importJson` は競合に遭遇した順に1件ずつ問い合わせるため、
   * 残り件数は事前に分からず「N件目」という進捗表示のみ行う。
   */
  count: number;
  /** ユーザーが選択を確定したら呼ぶ。 */
  onResolve: (resolution: ConflictResolution, applyToAll: boolean) => void;
}

/**
 * 独自JSONインポートのタイトル/フォルダ相違（真の競合）の解決ダイアログ（U15・UC-4）。
 *
 * `ImportExportService.importJson` の `ConflictResolver` から1件ずつ呼ばれる想定。「残りの競合にも
 * 適用する」を選ぶと、`ImportExportTab` 側がそれ以降ダイアログを出さずに同じ `resolution` を適用する
 * （`applyToAll` は本コンポーネントの状態としてのみ持ち、確定時に一度だけ呼び出し側へ伝える）。
 */
export const ConflictDialog = ({ existing, incoming, count, onResolve }: ConflictDialogProps) => {
  const [applyToAll, setApplyToAll] = useState(false);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
      <div
        role="dialog"
        aria-label="インポートの競合を解決"
        className="shadow-shell border-line w-[480px] rounded-lg border bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-ink text-[14px] font-bold">同じURLのブックマークが見つかりました</h2>
          <span className="text-ink-faint text-[11.5px]">競合 {count}件目</span>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="border-line rounded-md border p-3">
            <p className="text-ink-faint mb-1 text-[11px] font-bold">現在の登録</p>
            <p className="text-ink truncate text-[13px] font-medium" title={existing.title}>
              {existing.title}
            </p>
            <p className="text-ink-soft mt-1 truncate text-[11.5px]">{existing.folderPath.join(' / ') || '(直下)'}</p>
          </div>
          <div className="border-accent bg-accent-bg rounded-md border p-3">
            <p className="text-accent-strong mb-1 text-[11px] font-bold">インポートするデータ</p>
            <p className="text-ink truncate text-[13px] font-medium" title={incoming.title}>
              {incoming.title}
            </p>
            <p className="text-ink-soft mt-1 truncate text-[11.5px]">{incoming.folderPath.join(' / ') || '(直下)'}</p>
          </div>
        </div>

        <label className="text-ink-soft mb-4 flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={applyToAll} onChange={e => setApplyToAll(e.target.checked)} />
          残りの競合にもこの選択を適用する
        </label>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onResolve('skip', applyToAll)}
            className="text-ink-soft flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium">
            スキップ
          </button>
          <button
            type="button"
            onClick={() => onResolve('keepBoth', applyToAll)}
            className="border-line hover:bg-pane-3 flex h-8 items-center rounded-md border px-3 text-[12.5px] font-medium">
            両方残す
          </button>
          <button
            type="button"
            onClick={() => onResolve('overwrite', applyToAll)}
            className="bg-accent flex h-8 items-center rounded-md px-3 text-[12.5px] font-bold text-white">
            上書き
          </button>
        </div>
      </div>
    </div>
  );
};
