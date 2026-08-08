import { AliasEditor } from './AliasEditor.js';
import { Favicon } from './Favicon.js';
import { InlineEdit } from './InlineEdit.js';
import { cn } from '@extension/ui';
import type { CommitPlan, EditDraft } from './inlineEditModel.js';
import type { SearchResultItem } from '@extension/shared';
import type { MouseEvent } from 'react';

interface ResultRowProps {
  item: SearchResultItem;
  /** 選択中（↑↓/ホバーのハイライト対象）か。 */
  selected: boolean;
  /** 右ペイン（結果リスト）がキーボードフォーカスを持つか（AC-14 の相互アクセント用）。 */
  resultFocused?: boolean;
  /** この行が別名編集中（ALIAS_EDIT の対象）か。 */
  editingAlias?: boolean;
  /** この行がインライン編集中（INLINE_EDIT の対象）か。 */
  editingInline?: boolean;
  /** 他の行が編集中（別名/インラインいずれか）で、この行を薄暗くするか。 */
  dimmed?: boolean;
  /** クリックで開く。 */
  onOpen: () => void;
  /** ホバーで選択インデックスを合わせる。 */
  onHover: () => void;
  /** 別名エリアのクリックで別名編集に入る（ALIAS_EDIT）。 */
  onEnterAliasEdit?: () => void;
  /** 別名を永続化する（別名編集中のみ使用）。 */
  onCommitAliases?: (aliases: string[]) => Promise<void> | void;
  /** 別名編集を終了する（別名編集中のみ使用）。 */
  onCloseAliasEdit?: () => void;
  /** ホバーの編集アイコン/ダブルクリックでインライン編集に入る（INLINE_EDIT）。 */
  onEnterInlineEdit?: () => void;
  /** インライン編集の確定内容を反映する（インライン編集中のみ使用）。 */
  onCommitEdit?: (plan: CommitPlan) => void;
  /** インライン編集を終了する（インライン編集中のみ使用）。 */
  onCancelEdit?: () => void;
  /** ホバーの削除アイコンで削除する（アンドゥ付き）。 */
  onDelete?: () => void;
  /** 行のドラッグ開始候補（mousedown。5px 超で D&D 開始・U12）。編集中の行では渡さない。 */
  onDragStart?: (e: MouseEvent) => void;
}

/** 別名チップの最大表示数（docs/design「結果行の共通仕様」）。超過は `+N`。 */
const MAX_CHIPS = 3;

/** ASCII のみ（ローマ字/英数字）の別名は monospace（IBM Plex Mono）で表示する（docs/design）。 */
const isAscii = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) {
      return false;
    }
  }
  return true;
};

/**
 * 検索結果の1行（56px 2段組）。docs/design「右ペイン：結果行の共通仕様」に従う。
 * 1段目=ファビコン+タイトル / 2段目（padding-left:26px）=フォルダパス+別名チップ。
 * マッチした別名（`matchedAliases`）は先頭に寄せ accent 強調する。
 *
 * 別名編集中（`editingAlias`）は行を `<button>` から `<div>` に切り替え、2段目を `AliasEditor`（状態1e）に
 * 差し替える（input を button 内に置けない・クリックで開いてしまうため）。インライン編集中
 * （`editingInline`）も同様に `<div>` へ切り替え、`InlineEdit`（状態1d）を描画する（U10）。
 */
export const ResultRow = ({
  item,
  selected,
  resultFocused = false,
  editingAlias = false,
  editingInline = false,
  dimmed = false,
  onOpen,
  onHover,
  onEnterAliasEdit,
  onCommitAliases,
  onCloseAliasEdit,
  onEnterInlineEdit,
  onCommitEdit,
  onCancelEdit,
  onDelete,
  onDragStart,
}: ResultRowProps) => {
  const matched = item.matchedAliases;
  const others = item.aliases.filter(a => !matched.includes(a));
  const ordered = [...matched, ...others];
  // マッチした別名は省略対象から除外する（functional-design「マッチ別名は先頭ハイライトで省略対象外」）。
  // 最大表示数の残り枠に非マッチ別名を詰め、マッチ別名は件数超過でも必ず表示する。
  const otherSlots = Math.max(0, MAX_CHIPS - matched.length);
  const shown = [...matched, ...others.slice(0, otherSlots)];
  const extra = ordered.length - shown.length;

  // インライン編集中: 行を非ボタンのコンテナにし、InlineEdit（状態1d）を描画する。
  if (editingInline) {
    const original: EditDraft = { title: item.node.title, url: item.node.url ?? '' };
    return (
      <div className="w-full flex-none px-4 py-2">
        <InlineEdit original={original} onCommit={plan => onCommitEdit?.(plan)} onCancel={() => onCancelEdit?.()} />
      </div>
    );
  }

  // 別名編集中: 行は非ボタンのコンテナにし、1段目はテキスト、2段目を AliasEditor に差し替える。
  if (editingAlias) {
    return (
      <div className="border-line-row bg-row-selected flex min-h-14 w-full flex-none flex-col justify-center gap-[7px] border-b px-4 py-2 text-left">
        {/* 1段目（テキスト表示のまま） */}
        <span className="flex items-center gap-[10px]">
          <Favicon url={item.node.url ?? ''} />
          <span className="text-ink truncate text-[13.5px] font-medium">{item.node.title}</span>
        </span>
        {/* 2段目: 別名チップ入力（状態1e） */}
        <div className="pl-[26px]">
          <AliasEditor
            url={item.node.url ?? ''}
            initialAliases={item.aliases}
            matchedAliases={item.matchedAliases}
            onCommit={onCommitAliases ?? (() => undefined)}
            onClose={onCloseAliasEdit ?? (() => undefined)}
          />
        </div>
      </div>
    );
  }

  // 行クリックは既定で「開く」。別名チップ領域（data-alias-area）は別名編集、編集/削除アイコン
  // （data-row-action）はそれぞれの操作に分岐する。ネストした interactive 要素（button in button）を
  // 避けるため、単一の button 上でクリック対象により分岐する（既存の別名エリア分岐と同じ規律）。
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    const target = e.target as HTMLElement;
    if (onDelete && target.closest('[data-row-action="delete"]')) {
      onDelete();
      return;
    }
    if (onEnterInlineEdit && target.closest('[data-row-action="edit"]')) {
      onEnterInlineEdit();
      return;
    }
    if (onEnterAliasEdit && target.closest('[data-alias-area]')) {
      onEnterAliasEdit();
      return;
    }
    onOpen();
  };

  // ドラッグ開始は行本体のみ。編集/削除アイコン・別名エリア上の mousedown は既存のクリック分岐を優先する
  // （それらの領域での微小なブレでドラッグが誤発火しないようにする）。
  const handleMouseDown = (e: MouseEvent<HTMLButtonElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-row-action], [data-alias-area]')) {
      return;
    }
    onDragStart?.(e);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onDoubleClick={onEnterInlineEdit}
      onMouseEnter={onHover}
      onMouseDown={handleMouseDown}
      title={item.node.title}
      className={cn(
        'border-line-row group flex h-14 w-full flex-none flex-col justify-center gap-[5px] border-b px-4 text-left',
        // 相互アクセント（AC-14）: 右ペインがアクティブなら選択行を濃いめの accent 淡背景（強）、
        // 非アクティブなら中立グレー背景（弱）。左バーはフォーカス枠の外へはみ出して見えるため使わない。
        selected && resultFocused && 'bg-accent-bg-selected',
        selected && !resultFocused && 'bg-row-selected',
        !selected && 'hover:bg-pane-3',
        dimmed && 'opacity-40',
      )}>
      {/* 1段目 */}
      <span className="flex items-center gap-[10px]">
        <Favicon url={item.node.url ?? ''} />
        <span className="text-ink flex-1 truncate text-[13.5px] font-medium">{item.node.title}</span>
        {/* ホバー時に右端へフェードインする編集/削除アイコン（docs/design「hover: 右端に編集/削除アイコン」）。 */}
        <span className="flex flex-none items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <span
            data-row-action="edit"
            title="編集（F2）"
            className="text-ink-faint hover:text-accent flex h-6 w-6 items-center justify-center rounded">
            ✎
          </span>
          <span
            data-row-action="delete"
            title="削除（Delete）"
            className="text-ink-faint hover:text-danger flex h-6 w-6 items-center justify-center rounded">
            🗑
          </span>
        </span>
      </span>

      {/* 2段目 */}
      <span className="flex items-center gap-2 pl-[26px]">
        {item.folderPath.length > 0 && (
          <span className="text-ink-soft flex-none truncate text-[11.5px]">{item.folderPath.join(' / ')}</span>
        )}
        {/* 別名チップ領域: この範囲のクリックは別名編集に入る（handleClick が data 属性で判定）。 */}
        <span data-alias-area="true" title="クリックで別名を編集" className="flex items-center gap-2">
          {shown.map((alias, i) => {
            const isMatched = matched.includes(alias);
            return (
              <span
                key={`${alias}-${i}`}
                className={cn(
                  'flex-none rounded-full px-2 py-[2px] text-[11px] font-medium leading-[15px]',
                  isMatched ? 'bg-accent text-white' : 'bg-accent-bg text-accent-strong',
                  isAscii(alias) && 'font-mono',
                )}>
                {alias}
              </span>
            );
          })}
          {extra > 0 && (
            <span className="bg-chip-muted-bg text-chip-muted-text flex-none rounded-full px-[7px] py-[2px] font-mono text-[11px]">
              +{extra}
            </span>
          )}
          {/* 別名が無い行でも編集導線を出す（別名を付けて探しやすくする）。 */}
          {ordered.length === 0 && (
            <span className="text-ink-faint border-line-dashed rounded-full border border-dashed px-2 py-[2px] text-[11px]">
              ＋別名
            </span>
          )}
        </span>
      </span>
    </button>
  );
};
