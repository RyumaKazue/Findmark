import { SearchEngine, UndoManager, normalizer } from '@extension/shared';
import { AliasStore, TrashStore, bookmarkService, localStateStore, settingsStore } from '@extension/storage';

/**
 * ドメイン/データレイヤーの結線モジュール（U7・U10 で undoManager を追加、U16 で trashStore を追加）。
 *
 * `SearchEngine`（U6）・`AliasStore`（U5）は `Normalizer`（U3）を注入して生成する必要がある
 * （どちらも構造的インターフェースで受ける DI 設計）。`TrashStore`（U16）は復元処理で
 * `BookmarkService`/`AliasStore` を要するため、同じくここで注入して生成する。
 * 生成をここ1箇所へ集約し、UI 各所で `new` しない。索引を保持する `searchEngine`、アンドゥ状態を
 * 保持する `undoManager` を Popup 全体で共有するため、モジュールスコープの単一インスタンスにする。
 */
export const searchEngine = new SearchEngine(normalizer);
export const aliasStore = new AliasStore(normalizer);
export const undoManager = new UndoManager();
export const trashStore = new TrashStore(bookmarkService, aliasStore);
export { bookmarkService, localStateStore, settingsStore };
