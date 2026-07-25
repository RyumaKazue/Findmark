import { aliasStore, bookmarkService, searchEngine } from '../services.js';
import { useEffect, useMemo, useState } from 'react';
import type { SearchResultItem } from '@extension/shared';

/** インクリメンタル検索の debounce（docs/design「debounce 120ms 目安」）。 */
const DEBOUNCE_MS = 120;

export interface UseSearchResult {
  /** debounce 適用後の検索結果（U6 SearchEngine）。 */
  results: SearchResultItem[];
  /** 索引構築が完了したか。「読み込み中の空」と「本当に0件」を UI が区別するために使う。 */
  isIndexReady: boolean;
}

/**
 * 検索フック（U7）。
 *
 * - 起動時に1回だけ `SearchEngine.loadIndex`（`getTree`/`getAll` → 索引構築）を実行する。
 * - `query` の変化に対し、`debounce 120ms` 後に U6 の同期 `search()` を実行する。
 * - `folderId` が指定されると、そのフォルダ配下（サブフォルダ含む）に絞り込む（左ペインのフォルダ選択）。
 *   検索ボックスへのフォルダチップ挿入・直下トグル・ツリー⇄チップ同期は U11。空クエリは U6 のブラウズ（タイトル昇順）。
 */
export const useSearch = (query: string, folderId: string | null): UseSearchResult => {
  const [isIndexReady, setIsIndexReady] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  // 起動時1回: 索引構築。失敗は握り潰さずログのみ残し、UI は空結果として継続する
  // （索引未構築でも検索ボックスのフォーカス・入力を阻害しない）。
  useEffect(() => {
    let active = true;
    searchEngine
      .loadIndex(bookmarkService, aliasStore)
      .catch((e: unknown) => {
        console.error('[useSearch] 検索索引の構築に失敗しました:', e);
      })
      .finally(() => {
        if (active) {
          setIsIndexReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // 入力を debounce してからクエリへ反映する。
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const results = useMemo(() => {
    if (!isIndexReady) {
      return [];
    }
    const keywords = debouncedQuery.trim().split(/\s+/).filter(Boolean);
    const folderScope = folderId ? { folderId, includeSubfolders: true } : undefined;
    return searchEngine.search({ keywords, folderScope });
  }, [debouncedQuery, isIndexReady, folderId]);

  return { results, isIndexReady };
};
