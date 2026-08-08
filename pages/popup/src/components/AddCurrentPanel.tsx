import { AliasEditor } from './AliasEditor.js';
import { compressPath, formatPath } from './folderTreeModel.js';
import { buildMoveCandidates, clampIndex, filterCandidates } from './movePanelModel.js';
import { normalizer } from '@extension/shared';
import { cn } from '@extension/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FolderTreeNode } from './folderTreeModel.js';
import type { AddCurrentEntry } from '@src/hooks/useAddCurrent';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

/** Popup の document リスナーから呼ばれる命令ハンドル（U12/U13 と同方式）。 */
interface AddCurrentPanelActions {
  /** フォーカス位置に依らずパネルを閉じる（Escape）。 */
  close: () => void;
}

interface AddCurrentPanelProps {
  /** 編集対象（登録直後のブックマーク、または既存の登録）。 */
  entry: AddCurrentEntry;
  /** 左ペインと同じフォルダツリー（保存先候補の元）。 */
  folders: FolderTreeNode[];
  /** タイトル変更（フォーカスアウト確定）。 */
  onTitleChange: (title: string) => void;
  /** 保存先フォルダ変更。 */
  onFolderChange: (folderId: string, folderPath: string[]) => void;
  /** 別名変更（`AliasEditor` からそのまま渡す）。 */
  onAliasesChange: (aliases: string[]) => Promise<void> | void;
  /** `[削除]`（登録取り消し。5秒アンドゥ付き）。 */
  onDelete: () => void;
  /** `[完了]` / 背景クリック / Escape でパネルを閉じる（登録は残る）。 */
  onClose: () => void;
  /** キーボードインテント（Escape）を受け取るための命令ハンドル。 */
  actionsRef: RefObject<AddCurrentPanelActions | null>;
}

/**
 * 現在ページ登録の編集パネル（U14・デザインモック非該当領域）。
 *
 * `docs/design/` に本機能の視覚モックが存在しないため、既存の確立済みトークン（`MovePanel` のオーバーレイ・
 * カード・`AliasEditor` のチップ入力）を組み合わせた新規レイアウトにする。パネル全体を閉じる Escape は
 * Popup の document リスナーが `actionsRef` 経由で処理する（U12 で確立した、フォーカス位置に依らない
 * 命令ハンドル方式。背景の結果行が Enter/Escape を奪う不具合クラスを構造的に回避する）。保存先フォルダの
 * 絞り込み候補（`movePanelModel` を再利用）は自己完結した入れ子ウィジェットとし、その Escape は
 * ドロップダウンだけを閉じる（`AliasEditor` と同じ `stopPropagation` パターン）。
 */
export const AddCurrentPanel = ({
  entry,
  folders,
  onTitleChange,
  onFolderChange,
  onAliasesChange,
  onDelete,
  onClose,
  actionsRef,
}: AddCurrentPanelProps) => {
  const [title, setTitle] = useState(entry.title);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderQuery, setFolderQuery] = useState('');
  const [folderIndex, setFolderIndex] = useState(0);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // entry のタイトルが外部要因（別行の同時編集は無いが将来の再オープン等）で変わったら下書きを合わせる。
  useEffect(() => {
    setTitle(entry.title);
  }, [entry.title]);

  // 開いたらタイトル入力へフォーカスする（キーボード完結の起点）。
  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  // 命令ハンドルを毎レンダー最新の closure で公開する（FolderTree/MovePanel と同方式）。
  useEffect(() => {
    actionsRef.current = { close: onClose };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, onClose]);

  // 保存先フォルダ候補（現在の親を無効化しない＝新規登録なのでどのフォルダも選び直せる。design.md 参照）。
  const candidates = useMemo(() => buildMoveCandidates(folders, null), [folders]);
  const filtered = useMemo(
    () => filterCandidates(candidates, folderQuery, s => normalizer.normalizeText(s)),
    [candidates, folderQuery],
  );

  useEffect(() => {
    setFolderIndex(0);
  }, [folderQuery]);

  useEffect(() => {
    if (folderOpen) {
      folderInputRef.current?.focus();
    }
  }, [folderOpen]);

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setTitle(entry.title); // 空欄は許可しない（元の値へ戻す）。
      return;
    }
    if (trimmed !== entry.title) {
      onTitleChange(trimmed);
    }
  };

  const confirmFolder = (i: number) => {
    const candidate = filtered[i];
    if (!candidate) {
      return;
    }
    onFolderChange(candidate.id, candidate.path);
    setFolderOpen(false);
  };

  // 保存先フォルダの絞り込み入力が処理するキーは document レベルの Popup ハンドラへ伝播させない
  // （`AliasEditor` と同じ規律。パネル全体の Escape とドロップダウン自身の Escape を区別するため）。
  const handleFolderKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) {
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setFolderIndex(i => clampIndex(i + 1, filtered.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setFolderIndex(i => clampIndex(i - 1, filtered.length));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      confirmFolder(folderIndex);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // ドロップダウンだけを閉じる（パネル全体は閉じない＝入れ子の内側から先に閉じる）。
      setFolderOpen(false);
    }
  };

  // フォーカストラップ（Tab/Shift+Tab をパネル内に閉じ込める）。
  //
  // 本パネルは MovePanel と同じ「背景の結果リストが実 DOM に残ったまま重なるオーバーレイ」構造を持つ。
  // MovePanel は単一の入力欄しか持たないため「Tab を押すたびその入力欄へ再フォーカスする」だけで足りたが、
  // 本パネルはタイトル/フォルダ/別名/ボタンなど複数フィールドを Tab で行き来させたいため、その方式は使えない。
  // 代わりに一般的なモーダルのフォーカストラップ（最初/最後の要素で Tab/Shift+Tab をラップする）を実装し、
  // 背景の結果行ボタンへ実 DOM フォーカスが漏れる（＝Enter が背景のブックマークを開いてしまう。U12 で
  // 経験した不具合クラス）ことを構造的に防ぐ。
  const handleTrapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') {
      return;
    }
    const container = dialogRef.current;
    if (!container) {
      return;
    }
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'),
    ).filter(el => el.tabIndex !== -1);
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const activeInside = active instanceof HTMLElement && container.contains(active);
    if (e.shiftKey) {
      if (!activeInside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (!activeInside || active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const folderLabel = formatPath(compressPath(entry.folderPath));

  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center pt-10">
      {/* 背景オーバーレイ（クリックで閉じる）。MovePanel と同じ native button 方式。 */}
      <button
        type="button"
        aria-label="閉じる"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/20"
      />
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- モーダルのフォーカストラップ（Tab の閉じ込め）に必要。 */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="現在のページを登録"
        onKeyDown={handleTrapTab}
        className="shadow-shell border-line relative flex max-h-[480px] w-[400px] flex-col gap-3 overflow-y-auto rounded-lg border bg-white p-4">
        <div className="flex items-center justify-between">
          <span className="text-ink text-[13px] font-bold">ページを登録</span>
          {entry.alreadyRegistered && (
            <span className="bg-accent-bg text-accent-strong flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium">
              <span aria-hidden="true">★</span>
              登録済み
            </span>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-ink-soft text-[11px]">タイトル</span>
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={commitTitle}
            className="border-line focus:border-accent text-ink h-[34px] rounded-md border px-2.5 text-[13px] outline-none"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-ink-soft text-[11px]">保存先フォルダ</span>
          {!folderOpen ? (
            <button
              type="button"
              onClick={() => {
                setFolderQuery('');
                setFolderOpen(true);
              }}
              className="border-line hover:bg-pane-3 text-ink flex h-[34px] items-center gap-1.5 rounded-md border px-2.5 text-left text-[13px]">
              <span aria-hidden="true">📁</span>
              <span className="flex-1 truncate">{folderLabel || '（不明なフォルダ）'}</span>
            </button>
          ) : (
            <div className="border-line flex flex-col overflow-hidden rounded-md border">
              <input
                ref={folderInputRef}
                type="text"
                value={folderQuery}
                onChange={e => setFolderQuery(e.target.value)}
                onKeyDown={handleFolderKeyDown}
                onBlur={() => setFolderOpen(false)}
                placeholder="フォルダ名で絞り込み…"
                className="border-line-row text-ink h-[34px] border-b px-2.5 text-[13px] outline-none"
              />
              <div className="max-h-[160px] overflow-y-auto p-1">
                {filtered.length === 0 ? (
                  <div className="text-ink-faint px-2 py-3 text-center text-[11.5px]">該当するフォルダがありません</div>
                ) : (
                  filtered.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      // mousedown での blur（＝ドロップダウンの閉じ）を防ぎ click を確実に発火させる（MovePanel と同方式）。
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => confirmFolder(i)}
                      className={cn(
                        'flex w-full flex-col gap-0.5 rounded-md px-2 py-1 text-left',
                        i === folderIndex ? 'bg-accent-bg text-accent-strong' : 'text-ink hover:bg-pane-3',
                      )}>
                      <span className="truncate text-[12.5px] font-medium">{c.title}</span>
                      {c.path.length > 1 && (
                        <span className="text-ink-soft truncate text-[10.5px]">{c.path.join(' / ')}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-ink-soft text-[11px]">別名</span>
          <AliasEditor
            url={entry.url}
            initialAliases={entry.aliases}
            matchedAliases={[]}
            onCommit={onAliasesChange}
            onClose={onClose}
          />
        </div>

        <div className="mt-1 flex items-center justify-between">
          <button
            type="button"
            onClick={onDelete}
            className="border-danger-border text-danger flex h-[30px] items-center rounded-md border bg-white px-3 text-[12px] font-bold">
            削除
          </button>
          <button
            type="button"
            onClick={onClose}
            className="bg-accent flex h-[30px] items-center rounded-md px-4 text-[12px] font-bold text-white">
            完了
          </button>
        </div>
      </div>
    </div>
  );
};

export type { AddCurrentPanelActions };
