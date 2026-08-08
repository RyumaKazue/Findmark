import { buildMoveCandidates, clampIndex, filterCandidates } from './movePanelModel.js';
import { resolveKeyIntent } from '../hooks/modeMachine.js';
import { normalizer } from '@extension/shared';
import { cn } from '@extension/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FolderTreeNode } from './folderTreeModel.js';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

interface MovePanelProps {
  /** 左ペインと同じフォルダツリー（候補の元）。 */
  folders: FolderTreeNode[];
  /** 対象行の現在の親フォルダ ID（グレーアウト・確定弾き用。null = ルート直下等）。 */
  currentParentId: string | null;
  /** 移動先フォルダの決定（フルパスは表示・索引更新に使う）。 */
  onConfirm: (folderId: string, folderPath: string[]) => void;
  /** パネルを閉じる（Escape / 背景クリック）。 */
  onClose: () => void;
}

/**
 * フォルダ選択パネル（MovePanel・U12・PANEL モード / デザインのパネル）。
 *
 * `Ctrl(Cmd)+M` で開き、フォルダ名を絞り込み入力 → `↑↓` で候補移動 → `Enter` で移動する
 * （PRD 機能7「キーボード代替は必須」）。自前の `<input>` を持つため、キー処理はパネル内で自己完結する
 * （`isSearchFirstExempt('PANEL')` により検索ボックスへ奪われない）。現在の親フォルダはグレーアウトして
 * 選択・確定できない（AC-3）。マウス操作（候補クリック）でも確定できる。
 *
 * 絞り込み・候補構築・インデックスクランプは純粋モデル（`movePanelModel`）に委譲する。
 */
export const MovePanel = ({ folders, currentParentId, onConfirm, onClose }: MovePanelProps) => {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const candidates = useMemo(() => buildMoveCandidates(folders, currentParentId), [folders, currentParentId]);
  const filtered = useMemo(
    () => filterCandidates(candidates, query, s => normalizer.normalizeText(s)),
    [candidates, query],
  );

  // 開いたら絞り込み入力へフォーカスする（キーボード完結の起点）。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 絞り込みで候補が変わったら選択を先頭へ戻す。
  useEffect(() => {
    setIndex(0);
  }, [query]);

  // 選択候補が可視範囲外なら追従する。
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, filtered]);

  const confirmAt = (i: number) => {
    const candidate = filtered[i];
    // 現在の親（disabled）は確定できない（AC-3）。
    if (!candidate || candidate.disabled) {
      return;
    }
    onConfirm(candidate.id, candidate.path);
  };

  // キー処理はパネルのルートで委譲的に拾う（フォーカスが候補ボタン等に移っても ↑↓/Enter/Escape が効くように）。
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // IME 変換確定中の Enter/Escape 等を操作として扱わない（native event の isComposing を見る）。
    if (e.nativeEvent.isComposing) {
      return;
    }
    // Tab はフォーカスをパネル内（絞り込み input）に閉じ込める。パネル外の結果行へ逃がすと Escape 等が届かなくなる。
    if (e.key === 'Tab') {
      e.preventDefault();
      inputRef.current?.focus();
      return;
    }
    const intent = resolveKeyIntent('PANEL', e);
    switch (intent) {
      case 'panel:candidate-up':
        e.preventDefault();
        setIndex(i => clampIndex(i - 1, filtered.length));
        return;
      case 'panel:candidate-down':
        e.preventDefault();
        setIndex(i => clampIndex(i + 1, filtered.length));
        return;
      case 'panel:confirm':
        e.preventDefault();
        confirmAt(index);
        return;
      case 'panel:close':
        e.preventDefault();
        onClose();
        return;
      default:
        break;
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- キーは委譲で拾う（フォーカスは input に閉じ込め済み）。
    <div className="absolute inset-0 z-20 flex items-start justify-center pt-16" onKeyDown={handleKeyDown}>
      {/* 背景オーバーレイ（クリックで閉じる）。native button でキーボード/マウス双方に対応する。 */}
      <button
        type="button"
        aria-label="閉じる"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/20"
      />
      <div
        role="dialog"
        aria-label="フォルダを選択して移動"
        className="shadow-shell border-line relative flex max-h-[380px] w-[420px] flex-col overflow-hidden rounded-lg border bg-white">
        <div className="border-line-row flex-none border-b px-3 py-2.5">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="フォルダ名で絞り込み…"
            className="border-line focus:border-accent text-ink w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
          />
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="text-ink-faint px-3 py-6 text-center text-[12.5px]">該当するフォルダがありません</div>
          ) : (
            filtered.map((c, i) => {
              const selected = i === index;
              return (
                <button
                  key={c.id}
                  type="button"
                  data-selected={selected}
                  disabled={c.disabled}
                  aria-disabled={c.disabled}
                  tabIndex={-1}
                  onMouseDown={e => e.preventDefault()}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => confirmAt(i)}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left',
                    c.disabled
                      ? 'text-ink-faint cursor-not-allowed'
                      : selected
                        ? 'bg-accent-bg text-accent-strong cursor-pointer'
                        : 'text-ink hover:bg-pane-3 cursor-pointer',
                  )}>
                  <span className="flex w-full items-center gap-1.5">
                    <span aria-hidden="true">📁</span>
                    <span className="truncate text-[13px] font-medium">{c.title}</span>
                    {c.disabled && <span className="text-ink-faint ml-auto flex-none text-[11px]">現在の場所</span>}
                  </span>
                  {c.path.length > 1 && (
                    <span className="text-ink-soft truncate pl-[22px] text-[11px]">{c.path.join(' / ')}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
