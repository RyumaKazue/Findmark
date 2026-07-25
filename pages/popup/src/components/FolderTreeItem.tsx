import { cn } from '@extension/ui';
import type { FolderTreeNode } from './folderTreeModel.js';

interface FolderSelectChipProps {
  /** このフォルダが選択中（＝右ペインに中身を表示中）か。 */
  selected: boolean;
  onClick: () => void;
}

interface FolderTreeItemProps {
  folder: FolderTreeNode;
  /** 階層の深さ（0 = 最上位）。インデントガイドに使う。 */
  depth: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  /** 選択中フォルダ（null = すべて）。 */
  selectedFolderId: string | null;
  /** フォルダ選択の切り替え（null = すべてに戻す）。 */
  onSelectFolder: (id: string | null) => void;
}

/**
 * フォルダ選択チップ（フォルダ名の右・件数表示の位置に置換）。押下でそのフォルダを選択し、
 * 右ペインに中身（配下ブックマーク）を表示する。コンパクトなラジオ風トグル（18px）で、
 * 選択中は accent 塗り＋チェック、未選択はホバーで薄く表示する（深い階層でも名前幅を圧迫しない）。
 * 検索ボックスへのフォルダチップ挿入・直下トグル・ツリー⇄チップ同期は U11。
 */
export const FolderSelectChip = ({ selected, onClick }: FolderSelectChipProps) => (
  <button
    type="button"
    aria-pressed={selected}
    aria-label={selected ? 'このフォルダの表示を解除' : 'このフォルダの中身を表示'}
    title={selected ? 'このフォルダを表示中（クリックで解除）' : 'このフォルダの中身を表示'}
    onClick={onClick}
    className={cn(
      'flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[10px] leading-none',
      selected
        ? 'bg-accent text-white'
        : 'border-line-input hover:border-accent hover:text-accent border text-transparent',
    )}>
    ✓
  </button>
);

/**
 * 左ペインのフォルダ1行（+ 子の再帰描画）。
 * - 「展開三角 + フォルダ画像（📁） + フォルダ名」の全体を押下すると展開/折りたたみ（U7 は表示のみ）。
 * - フォルダ名の右の選択チップで、そのフォルダを選択して中身を表示する。
 * 展開永続・多階層省略・検索ボックスへのフォルダチップ挿入は U11。
 */
export const FolderTreeItem = ({
  folder,
  depth,
  expandedIds,
  onToggle,
  selectedFolderId,
  onSelectFolder,
}: FolderTreeItemProps) => {
  const hasChildren = folder.children.length > 0;
  const expanded = expandedIds.has(folder.id);
  const selected = selectedFolderId === folder.id;
  // 深い階層ほどインデントを詰め、最下層のフォルダ名幅を確保する（docs/design 2b「深階層はインデントを詰める」に準拠）。
  const childIndent = depth === 0 ? 'ml-[12px]' : depth <= 2 ? 'ml-[10px]' : 'ml-[6px]';

  const triangle = (
    <span
      className={cn('w-[10px] flex-none text-[9px]', expanded ? 'text-ink-faint' : 'text-triangle')}
      aria-hidden="true">
      {hasChildren ? (expanded ? '▾' : '▸') : ''}
    </span>
  );
  const icon = (
    <span className="flex-none text-[13px]" aria-hidden="true">
      📁
    </span>
  );
  const name = (
    <span className="min-w-0 flex-1 truncate text-[12.5px]" title={folder.title}>
      {folder.title}
    </span>
  );

  return (
    <div className="flex flex-col gap-[1px]">
      <div
        className={cn(
          'flex h-[30px] items-center gap-[6px] rounded-md',
          depth === 0 ? 'text-ink px-[10px] font-medium' : 'text-ink-2 px-2',
        )}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? '折りたたむ' : '展開'}
            onClick={() => onToggle(folder.id)}
            className="flex min-w-0 flex-1 items-center gap-[6px] text-left">
            {triangle}
            {icon}
            {name}
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-[6px]">
            {triangle}
            {icon}
            {name}
          </span>
        )}
        <FolderSelectChip selected={selected} onClick={() => onSelectFolder(selected ? null : folder.id)} />
      </div>

      {hasChildren && expanded && (
        <div className={cn('border-line flex flex-col gap-[1px] border-l pl-[8px]', childIndent)}>
          {folder.children.map(child => (
            <FolderTreeItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
};
