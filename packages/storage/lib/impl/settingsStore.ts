import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType, UserSettings } from '../types.js';

const storage = createStorage<UserSettings>(
  'user_settings',
  {
    trashRetentionDays: 30,
  },
  {
    storageEnum: StorageEnum.Sync,
    liveUpdate: true,
  },
);

type SettingsStorageType = BaseStorageType<UserSettings> & {
  setRetentionDays: (days: number) => Promise<void>;
  setLocale: (locale: UserSettings['locale']) => Promise<void>;
};

/** ユーザー設定（`chrome.storage.sync`、キー `user_settings`）。 */
export const settingsStore: SettingsStorageType = {
  ...storage,
  setRetentionDays: async days => {
    await storage.set(current => ({ ...current, trashRetentionDays: days }));
  },
  setLocale: async locale => {
    await storage.set(current => ({ ...current, locale }));
  },
};
