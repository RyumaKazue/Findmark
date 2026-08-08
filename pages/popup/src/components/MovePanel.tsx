import { buildMoveCandidates, clampIndex, filterCandidates } from './movePanelModel.js';
import { normalizer } from '@extension/shared';
import { cn } from '@extension/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FolderTreeNode } from './folderTreeModel.js';
import type { RefObject } from 'react';

/**
 * Popup の document リスナーから呼ばれるパネル操作（`panel:*` インテントの実行体）。
 * FolderTree の `FolderTreeActions` と同じ設計: キー処理は document レベルで一元化し、DOM フォーカスが
 * どこにあってもキー操作が一貫して効くようにする（背景の結果行ボタンに Enter が奪われて誤って開く問題の解消）。
 */
interface MovePanelActions {
  /** `panel:candidate-up`。候補を1つ上へ。 */
  selectPrev: () => void;
  /** `panel:candidate-down`。候補を1つ下へ。 */
  selectNext: () => void;
  /** `panel:confirm`。現在の候補を確定して移動（現在の親＝disabled なら何もしない）。 */
  confirm: () => void;
  /** `panel:close`。パネルを閉じる。 */
  close: () => void;
  /** `Tab`。フォーカスを絞り込み input へ引き戻す（文字入力を維持するため）。 */
  focusInput: () => void;
}

interface MovePanelProps {
  /** 左ペインと同じフォルダツリー（候補の元）。 */
  folders: FolderTreeNode[];
  /** 対象行の現在の親フォルダ ID（グレーアウト・確定弾き用。null = ルート直下等）。 */
  currentParentId: string | null;
  /** 移動先フォルダの決定（フルパスは表示・索引更新に使う）。 */
  onConfirm: (folderId: string, folderPath: string[]) => void;
  /** パネルを閉じる（Escape / 背景クリック）。 */
  onClose: () => void;
  /** キーボードインテントを受け取るための命令ハンドル（Popup の document リスナーが呼ぶ）。 */
  actionsRef: RefObject<MovePanelActions | null>;
}

/**
 * フォルダ選択パネル（MovePanel・U12・PANEL モード / デザインのパネル）。
 *
 * `Ctrl(Cmd)+M` で開き、フォルダ名を絞り込み入力 → `↑↓` で候補移動 → `Enter` で移動する
 * （PRD 機能7「キーボード代替は必須」）。**キー操作（↑↓/Enter/Escape/Tab）は Popup の document リスナーが
 * `actionsRef` 経由で実行する**（FolderTree と同じ命令ハンドル方式）。これにより、フォーカスが背景の結果行など
 * パネル外にあっても Enter が確定として働き、背景のブックマークを誤って開かない。文字入力は絞り込み input が
 * native に受ける（`↑↓/Enter/Escape` 以外のキーは document リスナーが素通しする）。現在の親フォルダは
 * グレーアウトして選択・確定できない（AC-3）。マウス操作（候補クリック）でも確定できる。
 *
 * 絞り込み・候補構築・インデックスクランプは純粋モデル（`movePanelModel`）に委譲する。
 */
export const MovePanel = ({ folders, currentParentId, onConfirm, onClose, actionsRef }: MovePanelProps) => {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const candidates = useMemo(() => buildMoveCandidates(folders, currentParentId), [folders, currentParentId]);
  const filtered = useMemo(
    () => filterCandidates(candidates, query, s => normalizer.normalizeText(s)),
    [candidates, query],
  );

  // 開いたら絞り込み入力へフォーカスする（文字入力の起点。キー操作自体は document リスナーが担う）。
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

  const confirmAt = useCallback(
    (i: number) => {
      const candidate = filtered[i];
      // 現在の親（disabled）は確定できない（AC-3）。
      if (!candidate || candidate.disabled) {
        return;
      }
      onConfirm(candidate.id, candidate.path);
    },
    [filtered, onConfirm],
  );

  // 命令ハンドルを毎レンダー最新の closure で公開する（FolderTree の actionsRef と同方式）。
  const selectPrev = useCallback(() => setIndex(i => clampIndex(i - 1, filtered.length)), [filtered.length]);
  const selectNext = useCallback(() => setIndex(i => clampIndex(i + 1, filtered.length)), [filtered.length]);
  const confirm = useCallback(() => confirmAt(index), [confirmAt, index]);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  useEffect(() => {
    actionsRef.current = { selectPrev, selectNext, confirm, close: onClose, focusInput };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, selectPrev, selectNext, confirm, onClose, focusInput]);

  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center pt-16">
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

export type { MovePanelActions };
