/**
 * Chrome ブックマークツリーのノード。
 *
 * `id` は Chrome が採番し、端末/アカウントで変わりうるため、別名の紐付けキーには
 * 使わない（紐付けキーには URL 正規化ハッシュ `AliasRecord.urlHash` を用いる）。
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
