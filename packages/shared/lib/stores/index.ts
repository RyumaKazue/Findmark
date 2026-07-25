import { normalizer } from '../search/index.js';
import { AliasStore } from '@extension/storage';

/**
 * 配線済みの `AliasStore` シングルトン。
 *
 * `AliasStore`（データレイヤー）は `Normalizer`（サービスレイヤー）を DI で受け取る設計のため
 * （`packages/storage` は `packages/shared` に依存できず、循環を避けるため実体を直接 import できない。
 * repository-structure.md「循環依存の禁止」参照）、依存は `shared → storage` の一方向のまま、
 * 合成（`new AliasStore(normalizer)`）はここ `packages/shared` 側で行う。
 */
export const aliasStore = new AliasStore(normalizer);

export { AliasStore, AliasLimitError } from '@extension/storage';
export type { AliasNormalizer } from '@extension/storage';
