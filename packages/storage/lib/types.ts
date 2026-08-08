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

/**
 * ポップアップを閉じた時点の UI 状態（機能13「ポップアップ状態の復元」/ U19）。次回起動時に復元する。
 *
 * `focusArea` の union は UI 層（`pages/popup/src/hooks/modeMachine.ts` の `FocusArea`）と**同一の文字列**だが、
 * レイヤー依存（UI→サービス→データ）で逆依存は禁止のため、最下層のデータ型としてここで独立に定義する。
 * 選択行は端末/アカウントで変わる**インデックスではなくブックマーク ID** で保持し、結果件数の増減でズレないようにする。
 */
export interface PopupSession {
  /** フォーカス位置。既定: `'folderTree'`（左ペイン）。 */
  focusArea: 'search' | 'result' | 'folderTree';
  /** フォルダスコープ。既定: `null`（=「すべて」）。 */
  scopeFolderId: string | null;
  /** 選択中ブックマークの ID。既定: 未指定（=先頭行）。ID で保持しインデックスでは持たない。 */
  selectedBookmarkId?: string;
  /** 検索クエリ。既定: `''`。 */
  query: string;
}

/** 端末固有の状態（`chrome.storage.local`、キー `local_state`、sync 不可）。 */
export interface LocalState {
  /** フォルダツリーの展開状態（フォルダ ID の配列）。 */
  expandedFolderIds: string[];
  /**
   * 展開状態の初期化済みフラグ（U11）。
   * 空配列だけでは「初回起動（既定で最上位を展開したい）」と「ユーザーが全て畳んだ」を区別できないため、
   * 初回に既定展開を書き込んだことを別に記録する。
   */
  isExpandedInitialized?: boolean;
  /** 現在ページ登録時の初期フォルダ（前回使用フォルダ）。 */
  lastUsedFolderId?: string;
  /**
   * ポップアップ状態の復元用セッション（U19・機能13）。未保存（初回起動）時は `undefined`。
   * `createStorage` の既定値オブジェクトには含めない（未保存を `undefined` で表し、既存の既定値の形を変えない）。
   */
  session?: PopupSession;
}
