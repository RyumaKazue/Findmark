import { Favicon } from './Favicon.js';
import { cn } from '@extension/ui';
import type { SearchResultItem } from '@extension/shared';

interface ResultRowProps {
  item: SearchResultItem;
  /** 選択中（↑↓/ホバーのハイライト対象）か。 */
  selected: boolean;
  /** クリックで開く。 */
  onOpen: () => void;
  /** ホバーで選択インデックスを合わせる。 */
  onHover: () => void;
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
 * マッチした別名（`matchedAliases`）は先頭に寄せ accent 強調する。編集/選択UIは U9/U10/U13。
 */
export const ResultRow = ({ item, selected, onOpen, onHover }: ResultRowProps) => {
  const matched = item.matchedAliases;
  const others = item.aliases.filter(a => !matched.includes(a));
  const ordered = [...matched, ...others];
  const shown = ordered.slice(0, MAX_CHIPS);
  const extra = ordered.length - shown.length;

  return (
    <button
      type="button"
      onClick={onOpen}
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
      </span>
    </button>
  );
};
