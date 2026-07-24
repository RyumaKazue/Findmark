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
