import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType, LocalState } from '../types.js';

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
        expandedFolderIds: isExpanded
          ? current.expandedFolderIds.filter(id => id !== folderId)
          : [...current.expandedFolderIds, folderId],
      };
    });
  },
};
