import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType, LocalState, PopupSession } from '../types.js';

const storage = createStorage<LocalState>(
  'local_state',
  {
    expandedFolderIds: [],
  },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

type LocalStateStorageType = BaseStorageType<LocalState> & {
  setLastUsedFolder: (folderId: string) => Promise<void>;
  toggleExpanded: (folderId: string) => Promise<void>;
  /** 指定 ID 群を展開状態へ追加する（既存はそのまま。スコープ設定時の祖先自動展開に使う）。 */
  expandFolders: (folderIds: string[]) => Promise<void>;
  /** 初回のみ既定の展開状態を書き込む（`isExpandedInitialized` を立てる）。2回目以降は何もしない。 */
  initializeExpanded: (folderIds: string[]) => Promise<void>;
  /** ポップアップ状態の復元用セッションを保存する（U19・機能13。`session` フィールドのみ更新）。 */
  saveSession: (session: PopupSession) => Promise<void>;
};

/** 端末固有の状態（`chrome.storage.local`、キー `local_state`）。 */
export const localStateStore: LocalStateStorageType = {
  ...storage,
  setLastUsedFolder: async folderId => {
    await storage.set(current => ({ ...current, lastUsedFolderId: folderId }));
  },
  toggleExpanded: async folderId => {
    await storage.set(current => {
      const isExpanded = current.expandedFolderIds.includes(folderId);
      return {
        ...current,
        // ユーザーが明示的に開閉した時点で初期化済みとみなす（次回起動で既定展開を上書きしない）。
        isExpandedInitialized: true,
        expandedFolderIds: isExpanded
          ? current.expandedFolderIds.filter(id => id !== folderId)
          : [...current.expandedFolderIds, folderId],
      };
    });
  },
  expandFolders: async folderIds => {
    if (folderIds.length === 0) {
      return;
    }
    await storage.set(current => {
      const merged = new Set(current.expandedFolderIds);
      for (const id of folderIds) {
        merged.add(id);
      }
      // 既存と差分が無ければ書き込みを避ける（無用な liveUpdate 通知を防ぐ）。
      if (merged.size === current.expandedFolderIds.length) {
        return current;
      }
      return { ...current, expandedFolderIds: [...merged] };
    });
  },
  initializeExpanded: async folderIds => {
    await storage.set(current => {
      if (current.isExpandedInitialized) {
        return current;
      }
      return {
        ...current,
        isExpandedInitialized: true,
        expandedFolderIds: [...folderIds],
      };
    });
  },
  saveSession: async session => {
    // 他フィールド（expandedFolderIds 等）を保ったまま session のみ差し替える。
    await storage.set(current => ({ ...current, session }));
  },
};
