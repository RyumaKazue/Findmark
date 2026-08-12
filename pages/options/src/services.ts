import { ImportExportService, normalizer } from '@extension/shared';
import { AliasStore, bookmarkService } from '@extension/storage';

/**
 * ドメイン/データレイヤーの結線モジュール（U15。popup の `services.ts` と同じ集約パターン）。
 *
 * `ImportExportService`（U15）と `AliasStore`（U5）は `Normalizer`（U3）を注入して生成する必要がある
 * （どちらも構造的インターフェースで受ける DI 設計）。生成をここ1箇所へ集約し、UI 各所で `new` しない。
 */
export const aliasStore = new AliasStore(normalizer);
export const importExportService = new ImportExportService(normalizer, bookmarkService, aliasStore);
export { bookmarkService };
