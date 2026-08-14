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

/* ------------------------------------------------------------------ *
 * ゴミ箱（U16・機能12「ゴミ箱(削除データの保持・復元)」）
 * ------------------------------------------------------------------ */

/**
 * ゴミ箱の1項目（`chrome.storage.local`、キー `trash`、`TrashItem[]` として保存）。
 *
 * 即時アンドゥ（5秒・メモリ、U10 `UndoManager`）とは別の第2層防御。削除時点の
 * URL・タイトル・元フォルダパス・別名を退避し、保持日数（既定30日・設定可）以内なら
 * オプションページの「ゴミ箱」タブから復元できる（functional-design.md UC-5）。
 */
export interface TrashItem {
  /** ゴミ箱内の一意ID（Chrome のブックマーク ID とは無関係。`TrashStore.push` が再採番する）。 */
  id: string;
  /** `bookmark` は単一ブックマーク、`folder` は配下ツリーごと保持する。 */
  kind: 'bookmark' | 'folder';
  /** `kind: 'bookmark'` のときの URL。folder のときは未定義。 */
  url?: string;
  /** タイトル（フォルダの場合はフォルダ名）。 */
  title: string;
  /** 削除時点の元階層（復元先。`BookmarkService.getFolderPath`/`ensureFolderPath` と同じ意味論）。 */
  folderPath: string[];
  /** 削除時点の別名（`kind: 'folder'` の場合は空配列）。 */
  aliases: string[];
  /** `kind: 'folder'` のとき、配下ノードを丸ごと保持する（ブックマーク/フォルダの入れ子）。 */
  children?: TrashItem[];
  /** 削除日時（epoch ms）。`purgeExpired`/`enforceLimits` の判定に使う。 */
  deletedAt: number;
}

/**
 * `TrashStore.push` の入力型。`TrashItem` から `id`（再採番）・`deletedAt`（削除日時）を除いたもの。
 *
 * 両フィールドともゴミ箱への格納責任（データレイヤー）に属し、呼び出し側（UI）に採番させると
 * 衝突・詐称の余地が生まれるため、型でも渡せないようにする（`push` 内部で `crypto.randomUUID()` /
 * `Date.now()` により子孫も含め再帰的に採番する）。
 */
export interface TrashInput {
  kind: 'bookmark' | 'folder';
  url?: string;
  title: string;
  folderPath: string[];
  aliases: string[];
  children?: TrashInput[];
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
  /**
   * 起動ショートカット（manifest の `commands._execute_action`）が未割り当てかどうか（U17）。
   *
   * `suggested_key`（`Ctrl+Shift+F`）は他拡張が先に取得しているとインストール時に**黙って未割り当て**になる
   * （PRD「起動ショートカットの割り当て」）。Service Worker が起動時に `chrome.commands.getAll()` で
   * 実際の割り当て状態を確認して書き込み、Options が `true` のときだけ案内を表示する。
   * `undefined`（未検証）と `false`（割り当て済み）はどちらも「案内を出さない」として扱う。
   */
  isShortcutUnassigned?: boolean;
}
