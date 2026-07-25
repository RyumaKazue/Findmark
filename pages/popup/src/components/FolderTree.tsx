import { FolderSelectChip, FolderTreeItem } from './FolderTreeItem.js';
import { buildFolderTree } from './folderTreeModel.js';
import { bookmarkService } from '../services.js';
import { useEffect, useState } from 'react';
import type { FolderTreeNode } from './folderTreeModel.js';

interface FolderTreeProps {
  /** 選択中フォルダ（null = すべて）。 */
  selectedFolderId: string | null;
  /** フォルダ選択の切り替え（null = すべてに戻す）。 */
  onSelectFolder: (id: string | null) => void;
}

/**
 * 左ペイン（220px）のフォルダツリー。ツリー表示・開閉のローカル切替に加え、フォルダ選択チップで
 * 選択したフォルダ配下（サブフォルダ含む）へ右ペインを絞り込む（U7）。
 * 検索ボックスへのフォルダチップ挿入・直下トグル・ツリー⇄チップ同期・展開永続・多階層省略は U11。
 */
export const FolderTree = ({ selectedFolderId, onSelectFolder }: FolderTreeProps) => {
  const [folders, setFolders] = useState<FolderTreeNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    bookmarkService
      .getTree()
      .then(tree => {
        if (!active) {
          return;
        }
        const built = buildFolderTree(tree);
        setFolders(built);
        // 既定で最上位フォルダを展開する（表示のみ・非永続。永続は U11）。
        setExpandedIds(new Set(built.map(f => f.id)));
      })
      .catch((e: unknown) => console.error('[FolderTree] フォルダツリーの取得に失敗しました:', e));
    return () => {
      active = false;
    };
  }, []);

  const toggle = (id: string) =>
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  return (
    <div className="flex h-full flex-col gap-[1px] overflow-auto px-2 py-3">
      <div className="text-ink flex h-8 items-center justify-between gap-[6px] rounded-md px-[10px] text-[12.5px] font-bold">
        すべて
        <FolderSelectChip selected={selectedFolderId === null} onClick={() => onSelectFolder(null)} />
      </div>
      {folders.map(folder => (
        <FolderTreeItem
          key={folder.id}
          folder={folder}
          depth={0}
          expandedIds={expandedIds}
          onToggle={toggle}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
        />
      ))}
    </div>
  );
};
