import { ResultRow } from './ResultRow.js';
import { computeWindow } from './virtualization.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CommitPlan } from './inlineEditModel.js';
import type { SearchResultItem } from '@extension/shared';

/** 結果行の固定高さ（docs/design「固定寸法」56px）。仮想スクロールの前提。 */
const ROW_HEIGHT = 56;

/**
 * 編集中に行が固定高を超えて縦に伸びる分の見積り上乗せ（px）。
 * 仮想スクロールは固定行高前提のため、編集行は 1 行分を超える。各エディタ側で高さを有界化した上で、
 * 総スクロール高にこの分を足して、末尾行を編集した際でも展開部分がスクロールで見切れないようにする。
 * 編集行以降の行はフロー内で自然に押し下がるため、オフセット計算自体の変更は不要。
 * インライン編集（状態1d・タイトル+URL+アクション）は別名編集（状態1e・チップ入力のみ）より伸びが大きい。
 */
const EDITING_ROW_EXTRA = { alias: 80, inline: 140 } as const;

interface ResultListProps {
  results: SearchResultItem[];
  /** ↑↓/ホバーで選択中のインデックス。 */
  selectedIndex: number;
  /** 結果0件時に中央表示する文言（読み込み中/本当に0件を呼び出し側が出し分ける）。 */
  emptyLabel: string;
  /** 右ペイン上部のメタ行文言（U11・スコープと件数）。null ならメタ行を描画しない（design 1a）。 */
  metaLabel?: string | null;
  /** 右ペイン（結果リスト）がキーボードフォーカスを持つか（AC-14 の相互アクセント用）。 */
  resultFocused?: boolean;
  /** 別名編集中（ALIAS_EDIT）の対象ブックマーク ID（`node.id`）。null なら編集なし。 */
  editingAliasId?: string | null;
  /** インライン編集中（INLINE_EDIT）の対象ブックマーク ID（`node.id`）。null なら編集なし。 */
  editingInlineId?: string | null;
  /** 指定インデックスのブックマークを開く。 */
  onOpen: (index: number) => void;
  /** ホバーで選択インデックスを合わせる。 */
  onHover: (index: number) => void;
  /** 指定インデックスの行で別名編集に入る。 */
  onEnterAliasEdit?: (index: number) => void;
  /** 別名編集中の行の別名を永続化する。 */
  onCommitAliases?: (aliases: string[]) => Promise<void> | void;
  /** 別名編集を終了する。 */
  onCloseAliasEdit?: () => void;
  /** 指定インデックスの行でインライン編集に入る。 */
  onEnterInlineEdit?: (index: number) => void;
  /** インライン編集中の行の確定内容を反映する。 */
  onCommitEdit?: (plan: CommitPlan) => void;
  /** インライン編集を終了する。 */
  onCancelEdit?: () => void;
  /** 指定インデックスの行を削除する。 */
  onDeleteRow?: (index: number) => void;
}

/**
 * 右ペインの検索結果リスト（自前の仮想スクロール）。
 * 固定行高で可視範囲のみ描画し、件数増加に対して描画コストを一定化する（docs/architecture パフォーマンス）。
 *
 * スクロールコンテナは結果0件時（読み込み中・空状態）でも**常時マウント**する。こうしないと、初回マウント時点で
 * 索引構築中（results 0 件）だとコンテナが DOM に無く `clientHeight` を計測できず、`viewportHeight` が 0 のまま固定され、
 * `computeWindow` が空ウィンドウを返して結果到着後も何も描画されない（右ペインが真っ白になる）。
 * 高さは `ResizeObserver` でも追従し、レイアウト確定・リサイズに追随する。
 */
export const ResultList = ({
  results,
  selectedIndex,
  emptyLabel,
  metaLabel = null,
  resultFocused = false,
  editingAliasId = null,
  editingInlineId = null,
  onOpen,
  onHover,
  onEnterAliasEdit,
  onCommitAliases,
  onCloseAliasEdit,
  onEnterInlineEdit,
  onCommitEdit,
  onCancelEdit,
  onDeleteRow,
}: ResultListProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // ビューポート高を計測し、リサイズにも追従する（コンテナは常時マウントされているため確実に取得できる）。
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const measure = () => setViewportHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 選択行が可視範囲外なら追従してスクロールする。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || results.length === 0) {
      return;
    }
    const rowTop = selectedIndex * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < el.scrollTop) {
      el.scrollTop = rowTop;
    } else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowBottom - el.clientHeight;
    }
  }, [selectedIndex, results.length]);

  const { startIndex, endIndex, offsetY, totalHeight } = computeWindow({
    scrollTop,
    viewportHeight,
    rowHeight: ROW_HEIGHT,
    count: results.length,
  });
  const visible = results.slice(startIndex, endIndex);
  // 編集行は固定高を超えるため、総スクロール高に上乗せして末尾編集時の見切れを防ぐ。
  const editingExtra = editingInlineId ? EDITING_ROW_EXTRA.inline : editingAliasId ? EDITING_ROW_EXTRA.alias : 0;
  const spacerHeight = totalHeight + editingExtra;
  const isAnyEditing = editingAliasId !== null || editingInlineId !== null;

  return (
    // メタ行はスクロールコンテナの外側上部に固定し、仮想スクロールの高さ計測（ResizeObserver）に影響させない。
    <div className="flex h-full flex-col">
      {metaLabel !== null && (
        <div className="bg-pane-3 border-line-row text-ink-soft flex h-[34px] flex-none items-center border-b px-4 text-[11.5px]">
          {metaLabel}
        </div>
      )}
      <div
        ref={containerRef}
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-auto">
        {results.length === 0 ? (
          <div className="text-ink-faint flex h-full items-center justify-center px-6 text-center text-[12.5px]">
            {emptyLabel}
          </div>
        ) : (
          // 総高スペーサ + 可視分のみ translateY で配置
          <div style={{ height: spacerHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${offsetY}px)`, position: 'absolute', top: 0, left: 0, right: 0 }}>
              {visible.map((item, i) => {
                const index = startIndex + i;
                const isEditingThisAlias = item.node.id === editingAliasId;
                const isEditingThisInline = item.node.id === editingInlineId;
                return (
                  <ResultRow
                    key={item.node.id}
                    item={item}
                    selected={index === selectedIndex}
                    resultFocused={resultFocused}
                    editingAlias={isEditingThisAlias}
                    editingInline={isEditingThisInline}
                    dimmed={isAnyEditing && !isEditingThisAlias && !isEditingThisInline}
                    onOpen={() => onOpen(index)}
                    onHover={() => onHover(index)}
                    onEnterAliasEdit={onEnterAliasEdit ? () => onEnterAliasEdit(index) : undefined}
                    onCommitAliases={onCommitAliases}
                    onCloseAliasEdit={onCloseAliasEdit}
                    onEnterInlineEdit={onEnterInlineEdit ? () => onEnterInlineEdit(index) : undefined}
                    onCommitEdit={onCommitEdit}
                    onCancelEdit={onCancelEdit}
                    onDelete={onDeleteRow ? () => onDeleteRow(index) : undefined}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
