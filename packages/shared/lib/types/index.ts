// データモデル型はデータレイヤー(@extension/storage)が正。ここで再エクスポートし、
// consumer は従来どおり @extension/shared からも取得できるようにする(依存は shared→storage の一方向)。
export type { BookmarkNode, AliasRecord, AliasChunk, AliasIndex } from '@extension/storage';
// サービスレイヤー固有の型は shared に置く。
export type * from './search.js';
