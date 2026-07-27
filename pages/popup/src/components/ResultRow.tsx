import { AliasEditor } from './AliasEditor.js';
import { Favicon } from './Favicon.js';
import { cn } from '@extension/ui';
import type { SearchResultItem } from '@extension/shared';
import type { MouseEvent } from 'react';

interface ResultRowProps {
  item: SearchResultItem;
  /** 選択中（↑↓/ホバーのハイライト対象）か。 */
  selected: boolean;
  /** この行が別名編集中（ALIAS_EDIT の対象）か。 */
  editingAlias?: boolean;
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
 * 差し替える（input を button 内に置けない・クリックで開いてしまうため）。インライン編集/選択UIは U10/U13。
 */
export const ResultRow = ({
  item,
  selected,
  editingAlias = false,
  onOpen,
  onHover,
  onEnterAliasEdit,
  onCommitAliases,
  onCloseAliasEdit,
}: ResultRowProps) => {
  const matched = item.matchedAliases;
  const others = item.aliases.filter(a => !matched.includes(a));
  const ordered = [...matched, ...others];
  // マッチした別名は省略対象から除外する（functional-design「マッチ別名は先頭ハイライトで省略対象外」）。
  // 最大表示数の残り枠に非マッチ別名を詰め、マッチ別名は件数超過でも必ず表示する。
  const otherSlots = Math.max(0, MAX_CHIPS - matched.length);
  const shown = [...matched, ...others.slice(0, otherSlots)];
  const extra = ordered.length - shown.length;

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

  // 行クリックは既定で「開く」。ただし別名チップ領域（data-alias-area）内のクリックは別名編集に入る。
  // ネストした interactive 要素（button in button）を避けるため、単一の button 上でクリック対象により分岐する。
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (onEnterAliasEdit && (e.target as HTMLElement).closest('[data-alias-area]')) {
      onEnterAliasEdit();
      return;
    }
    onOpen();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={onHover}
      title={item.node.title}
      className={cn(
        'border-line-row flex h-14 w-full flex-none flex-col justify-center gap-[5px] border-b px-4 text-left',
        selected ? 'bg-row-selected' : 'hover:bg-pane-3',
      )}>
      {/* 1段目 */}
      <span className="flex items-center gap-[10px]">
        <Favicon url={item.node.url ?? ''} />
        <span className="text-ink truncate text-[13.5px] font-medium">{item.node.title}</span>
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
