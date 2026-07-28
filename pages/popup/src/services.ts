import { SearchEngine, UndoManager, normalizer } from '@extension/shared';
import { AliasStore, bookmarkService } from '@extension/storage';

/**
 * ドメイン/データレイヤーの結線モジュール（U7・U10 で undoManager を追加）。
 *
 * `SearchEngine`（U6）と `AliasStore`（U5）は `Normalizer`（U3）を注入して生成する必要がある
 * （どちらも構造的インターフェースで受ける DI 設計）。生成をここ1箇所へ集約し、UI 各所で `new` しない。
 * 索引を保持する `searchEngine`、アンドゥ状態を保持する `undoManager` を Popup 全体で共有するため、
 * モジュールスコープの単一インスタンスにする。
 */
export const searchEngine = new SearchEngine(normalizer);
export const aliasStore = new AliasStore(normalizer);
export const undoManager = new UndoManager();
export { bookmarkService };
