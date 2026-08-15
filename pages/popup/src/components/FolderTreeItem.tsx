import { TRUNCATE_DEPTH } from './folderTreeModel.js';
import { useI18n } from '@extension/i18n';
import { cn } from '@extension/ui';
import type { TreeRow } from './folderTreeModel.js';
import type { MouseEvent } from 'react';

interface FolderTreeItemProps {
  /** 描画対象の可視行（「すべて」/ フォルダ / 「さらに N 件…」）。 */
  row: TreeRow;
  /** この行が現在のスコープか（「すべて」行なら scope=null のとき、フォルダ行なら scope=folder.id のとき）。 */
  scoped: boolean;
  /** 左ペイン（フォルダツリー）自体がキーボードフォーカスを持つか（AC-14 の相互アクセント用）。 */
  paneFocused: boolean;
  /** この行がフォーカス中か（主に「さらに N 件…」行の薄い背景に使う）。 */
  focused: boolean;
  /** フォルダ行が展開中か。 */
  expanded: boolean;
  /** D&D のドロップ先候補として破線ハイライトするか（U12）。フォルダ行のみ有効。 */
  dropTarget?: boolean;
  /** 展開/折りたたみ（三角ボタン）。子なしフォルダでは呼ばれない。 */
  onToggleExpand: () => void;
  /** スコープ選択（フォルダ名・「すべて」のクリック）。 */
  onSelectScope: () => void;
  /** 「さらに N 件…」で残りを表示する。 */
  onRevealMore: () => void;
  /** スクロール追従のための行要素登録。 */
  registerRef: (el: HTMLElement | null) => void;
}

/** 深さ分のインデントガイド線セルを描く（design 2a/2b。第4階層以降は詰める）。 */
const IndentGuides = ({ depth }: { depth: number }) => (
  <>
    {Array.from({ length: depth }, (_, i) => (
      <span
        key={i}
        aria-hidden="true"
        className="border-line flex-none self-stretch border-l"
        style={{ width: i >= TRUNCATE_DEPTH ? 8 : 14 }}
      />
    ))}
  </>
);

/** クリックでフォーカスを奪わせず、ハンドラ実行後はクリック側（FolderTree）がツリールートへ戻す（AC-8）。 */
const preventFocusSteal = (e: MouseEvent) => e.preventDefault();

/**
 * 左ペインの可視行1件（U11・フラット描画）。押下対象を2つに分離する:
 * - **展開三角（chevron ボタン）**: 展開/折りたたみ専用（子ありのみ・素の ▸/▾ ではなく押下と分かる見た目）。
 * - **「📁 フォルダ名」**: スコープ選択（子なしフォルダも押下可）。スコープ中は accent 塗り + 白文字。
 *
 * キーボード操作は Popup の document リスナーが担うため、行内 `<button>` はフォーカスを保持しない
 * （`onMouseDown` で preventDefault し、クリック処理側がツリールートへ DOM フォーカスを戻す = AC-8）。
 */
export const FolderTreeItem = ({
  row,
  scoped,
  paneFocused,
  focused,
  expanded,
  dropTarget = false,
  onToggleExpand,
  onSelectScope,
  onRevealMore,
  registerRef,
}: FolderTreeItemProps) => {
  const { t } = useI18n();
  // 相互アクセント（AC-14）: アクティブ時のスコープは accent 塗り + 白（強）、
  // 非アクティブ時は accent 淡背景 + accent 文字（弱）。フォーカスがどのペインにあるかを色で示す。
  const scopedStrong = scoped && paneFocused;
  const scopedMuted = scoped && !paneFocused;
  // 「すべて」行: 最上位・太字・高さ32（design「ツリー行 30（最上位32）」）。
  if (row.kind === 'all') {
    return (
      <div ref={registerRef} role="treeitem" aria-selected={scoped} className="flex h-8 items-center">
        <button
          type="button"
          aria-current={scoped ? 'true' : undefined}
          onMouseDown={preventFocusSteal}
          onClick={onSelectScope}
          className={cn(
            'flex h-8 flex-1 cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-md px-[10px] text-left text-[14px] font-bold',
            scopedStrong && 'bg-accent text-white',
            scopedMuted && 'bg-accent-bg text-accent-strong',
            !scoped && 'text-ink hover:bg-accent-bg',
          )}>
          <span aria-hidden="true">📁</span>
          <span>{t('commonAll')}</span>
        </button>
      </div>
    );
  }

  // 「さらに N 件…」行: フォルダではないためスコープにならない。フォーカス中は薄い背景で位置を示す。
  if (row.kind === 'more') {
    return (
      <div ref={registerRef} role="treeitem" aria-selected={false} className="flex h-[26px] items-center">
        <IndentGuides depth={row.depth} />
        <button
          type="button"
          onMouseDown={preventFocusSteal}
          onClick={onRevealMore}
          className={cn(
            'text-ink-faint flex h-[26px] flex-1 cursor-pointer items-center rounded-md px-2 text-left text-[11px]',
            focused ? 'bg-pane-3' : 'hover:bg-pane-3',
          )}>
          {t('popupTreeMore', String(row.hiddenCount))}
        </button>
      </div>
    );
  }

  // フォルダ行。
  const folder = row.folder;
  const hasChildren = folder.children.length > 0;

  return (
    <div ref={registerRef} role="treeitem" aria-selected={scoped} className="flex h-[30px] items-center">
      <IndentGuides depth={row.depth} />
      {/*
        行の強調（accent 塗り・角丸・ホバー）は chevron とフォルダ名の**両方を包む**このラッパが持つ。
        design mock（docs/design/Findmark Popup.dc.html L61）の選択中フォルダ行は塗りの内側に三角があり、
        README「三角は rgba(255,255,255,0.75)」もそれを前提にした記述。U11 で押下対象を2つのボタンへ
        分離した際に塗りが「名前ボタンだけ」に縮み、chevron が明るい背景の上に取り残されて
        白75%が見えなくなっていた。インデントガイド線は塗りの外に残す（design 2a）。
      */}
      <div
        // D&D のドロップ先判定（`useDragAndDrop` の `elementFromPoint` → `closest('[data-folder-id]')`）は
        // **ハイライト（下の dropTarget outline）と同じ要素**に置く。名前ボタン側に残すと、光っている範囲より
        // 実際に落とせる範囲が狭くなる（chevron 上・ラッパの padding 上でドロップが効かない）。
        data-folder-id={folder.id}
        className={cn(
          'flex h-[30px] flex-1 items-center gap-[6px] rounded-md px-1.5 text-[14px]',
          scopedStrong && 'bg-accent font-bold text-white',
          scopedMuted && 'bg-accent-bg text-accent-strong font-bold',
          !scoped && 'text-ink-2 hover:bg-accent-bg',
          // D&D ドロップ先候補（U12 AC-2/AC-3）: 破線でハイライト。outline はレイアウトに影響しない。
          dropTarget && 'outline-accent outline-dashed outline-2 -outline-offset-2',
        )}>
        {/* 展開トグル（子ありのみ）。子なしは同寸の空枠でインデントを揃える。 */}
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? t('popupTreeCollapse') : t('popupTreeExpand')}
            // aria-label はスクリーンリーダー用でツールチップにならないため、マウス利用者向けに title も出す。
            title={expanded ? t('popupTreeCollapse') : t('popupTreeExpand')}
            aria-expanded={expanded}
            onMouseDown={preventFocusSteal}
            onClick={onToggleExpand}
            className={cn(
              'flex size-5 flex-none cursor-pointer items-center justify-center rounded',
              // スコープ中の行は**静止状態でも背景を持たせる**。キーボード操作中はホバーが起きないため、
              // ホバー時にしか手掛かりが出ないと「ここを押せば開ける」と分からない（U11 AC-8 の強化）。
              scopedStrong && 'bg-white/20 text-white hover:bg-white/35',
              scopedMuted && 'bg-accent/15 text-accent-strong hover:bg-accent/25',
              // 非スコープ行は従来どおりホバーのみ（220px の左ペインで全行に背景を出すと煩雑になるため）。
              !scoped && 'text-triangle hover:bg-accent-bg',
            )}>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              aria-hidden="true"
              className={cn('transition-transform', expanded && 'rotate-90')}>
              <path
                d="M3.5 2 L6.5 5 L3.5 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <span aria-hidden="true" className="size-5 flex-none" />
        )}
        {/* スコープ選択（子なしフォルダも押下可）。ドロップ先判定用の data-folder-id は親ラッパが持つ。 */}
        <button
          type="button"
          aria-current={scoped ? 'true' : undefined}
          title={folder.title}
          onMouseDown={preventFocusSteal}
          onClick={onSelectScope}
          className="flex h-[30px] flex-1 cursor-pointer items-center gap-[6px] whitespace-nowrap text-left">
          <span aria-hidden="true" className="text-[15px]">
            {hasChildren && expanded ? '📂' : '📁'}
          </span>
          <span>{folder.title}</span>
        </button>
      </div>
    </div>
  );
};
