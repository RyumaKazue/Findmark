import { normalizer } from '@extension/shared';
import { AliasStore, TrashStore, bookmarkService, localStateStore, settingsStore } from '@extension/storage';

/**
 * Service Worker コンテキストの結線モジュール（U17）。
 *
 * `pages/popup/src/services.ts` / `pages/options/src/services.ts` と同じ役割。`AliasStore` は
 * `Normalizer` の注入が必須（`packages/storage` は `packages/shared` に依存できない）、`TrashStore` は
 * 復元処理で `BookmarkService`/`AliasStore` を要するため、生成をここ1箇所へ集約する。
 *
 * SW は起動のたびに再評価されるため、ここではインスタンス生成のみを行い I/O は実行しない。
 */
export const aliasStore = new AliasStore(normalizer);
export const trashStore = new TrashStore(bookmarkService, aliasStore);
export { bookmarkService, localStateStore, settingsStore, normalizer };
