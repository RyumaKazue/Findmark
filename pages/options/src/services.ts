import { ImportExportService, normalizer } from '@extension/shared';
import { AliasStore, TrashStore, bookmarkService, settingsStore } from '@extension/storage';

/**
 * ドメイン/データレイヤーの結線モジュール（U15。popup の `services.ts` と同じ集約パターン。U16 で trashStore を追加）。
 *
 * `ImportExportService`（U15）・`AliasStore`（U5）は `Normalizer`（U3）を注入して生成する必要がある
 * （どちらも構造的インターフェースで受ける DI 設計）。`TrashStore`（U16）は復元処理で
 * `BookmarkService`/`AliasStore` を要するため、同じくここで注入して生成する。
 * 生成をここ1箇所へ集約し、UI 各所で `new` しない。
 */
export const aliasStore = new AliasStore(normalizer);
export const importExportService = new ImportExportService(normalizer, bookmarkService, aliasStore);
export const trashStore = new TrashStore(bookmarkService, aliasStore);
export { bookmarkService, settingsStore };
