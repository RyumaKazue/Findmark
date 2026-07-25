import type { ValueOrUpdateType } from './base/index.js';

export type BaseStorageType<D> = {
  get: () => Promise<D>;
  set: (value: ValueOrUpdateType<D>) => Promise<void>;
  getSnapshot: () => D | null;
  subscribe: (listener: () => void) => () => void;
};

/* ------------------------------------------------------------------ *
 * ドメインデータ型（データレイヤーが正）
 *
 * レイヤー依存（UI→サービス→データ）を循環なく保つため、データモデル型は
 * 最下層の storage に置く。`packages/shared` はこれらを再エクスポートし、
 * consumer は従来どおり `@extension/shared` からも取得できる。
 * ------------------------------------------------------------------ */

/**
 * Chrome ブックマークツリーのノード（chrome の BookmarkTreeNode をドメイン向けに写像した型）。
 *
 * `id` は Chrome が採番し端末/アカウントで変わりうるため、別名の紐付けキーには使わない
 * （紐付けキーには URL 正規化ハッシュ `AliasRecord.urlHash` を用いる）。
 */
export interface BookmarkNode {
  /** Chrome 採番 ID。端末/アカウントで変わりうる → 紐付けキーには使わない。 */
  id: string;
  /** 親フォルダ ID。ルート直下等では未定義になりうる。 */
  parentId?: string;
  /** タイトル（フォルダの場合はフォルダ名にもなる）。 */
  title: string;
  /** URL。未定義ならフォルダを表す。 */
  url?: string;
  /** 追加日時（epoch ms）。 */
  dateAdded?: number;
  /** 子ノード（フォルダの場合）。 */
  children?: BookmarkNode[];
}

/**
 * 独自データ（別名）。ブックマークとは URL 正規化ハッシュ（`urlHash`）で紐付ける。
 * ID 非依存にすることで、端末/アカウントをまたいでも別名が外れない（移行に強い）。
 */
export interface AliasRecord {
  /** URL 正規化後のハッシュ（紐付けキー）。`Normalizer.hashUrl(url)` で生成する。 */
  urlHash: string;
  /** 突合・復元・エクスポート用に原 URL も保持する。 */
  url: string;
  /**
   * 別名の配列。1 件あたり最大 20 個、各要素は最大 50 文字。
   * 正規化（`Normalizer.normalizeText`）後に比較して重複を排除する（検証実装は U5 AliasStore）。
   */
  aliases: string[];
  /** 更新日時（epoch ms）。 */
  updatedAt: number;
}

/**
 * `chrome.storage.sync` 上の格納形式。
 * key: `alias_chunk_0`, `alias_chunk_1`, ... 各チャンクは `urlHash → AliasRecord` のマップ。
 * 8KB/アイテム制限を回避するためバイト長ベースで分割する（分割ロジックは U5）。
 */
export type AliasChunk = Record<string /* urlHash */, AliasRecord>;

/**
 * 別名チャンクの逆引きインデックス。key: `alias_index`。
 */
export interface AliasIndex {
  /** 現在のチャンク数。 */
  chunkCount: number;
  /** urlHash → チャンク番号の逆引き。 */
  hashToChunk: Record<string, number>;
  /** 容量超過時に sync から local へフォールバックした状態を表す。 */
  storageMode: 'sync' | 'local';
}

/* ------------------------------------------------------------------ *
 * ユーザー設定 / 端末状態（U4 で追加）
 * ------------------------------------------------------------------ */

/** ユーザー設定（`chrome.storage.sync`、キー `user_settings`）。 */
export interface UserSettings {
  /** ゴミ箱の保持日数。既定 30。 */
  trashRetentionDays: number;
  /** UI ロケール（未指定なら既定ロケール）。 */
  locale?: 'ja' | 'en';
}

/** 端末固有の状態（`chrome.storage.local`、キー `local_state`、sync 不可）。 */
export interface LocalState {
  /** フォルダツリーの展開状態（フォルダ ID の配列）。 */
  expandedFolderIds: string[];
  /** 現在ページ登録時の初期フォルダ（前回使用フォルダ）。 */
  lastUsedFolderId?: string;
}
