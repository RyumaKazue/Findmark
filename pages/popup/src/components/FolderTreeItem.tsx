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
 * フォルダ選択ボタン（📎クリップ・件数表示の位置に置換）。押下でそのフォルダを選択し、
 * 右ペインに中身（配下ブックマーク）を表示する。選択状態はチェックのように強調せず、押すためのボタンに徹する。
 * 横スクロール時も常に見えるよう `sticky right-0` で右端に固定し、背景でスクロール中の名前を隠す。
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
      'sticky right-0 ml-auto flex-none cursor-pointer rounded-md px-1.5 py-0.5 text-[15px] leading-none',
      selected ? 'bg-accent-bg' : 'bg-pane hover:bg-accent-bg',
    )}>
    📎
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

  // 配下フォルダを持つ行は開閉三角を濃く表示し「押せる」ことを示す（子なしは三角なし）。
  const triangle = (
    <span
      className={cn('w-[12px] flex-none text-[11px]', expanded ? 'text-ink-faint' : 'text-ink-soft')}
      aria-hidden="true">
      {hasChildren ? (expanded ? '▾' : '▸') : ''}
    </span>
  );
  // 配下があり展開中は開いたフォルダ（📂）、それ以外は閉じたフォルダ（📁）。開閉状態を直感的に示す。
  const icon = (
    <span className="flex-none text-[16px]" aria-hidden="true">
      {hasChildren && expanded ? '📂' : '📁'}
    </span>
  );
  // 名前は省略せず表示し、見切れる場合は左ペインの横スクロール（スライド）で全表示する。
  const name = (
    <span className="whitespace-nowrap text-[14px]" title={folder.title}>
      {folder.title}
    </span>
  );

  return (
    <div className="flex flex-col gap-[1px]">
      <div
        className={cn(
          'flex h-[34px] items-center gap-[6px] rounded-md',
          depth === 0 ? 'text-ink px-[10px] font-medium' : 'text-ink-2 px-2',
        )}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? '折りたたむ' : '展開'}
            onClick={() => onToggle(folder.id)}
            className="hover:bg-accent-bg flex cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-md px-1 py-0.5 text-left">
            {triangle}
            {icon}
            {name}
          </button>
        ) : (
          // 子のないフォルダは開閉不可。押下対象にせず（三角なし・ホバーなし）、選択は 📎 のみ。
          <span className="text-ink-faint flex items-center gap-[6px] whitespace-nowrap px-1 py-0.5">
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
