import { aliasStore, bookmarkService, searchEngine } from '../services.js';
import { useCallback, useEffect, useState } from 'react';
import type { SearchResultItem } from '@extension/shared';

/** インクリメンタル検索の debounce（docs/design「debounce 120ms 目安」）。 */
const DEBOUNCE_MS = 120;

export interface UseSearchResult {
  /** debounce 適用後の検索結果（U6 SearchEngine）。 */
  results: SearchResultItem[];
  /** 索引構築が完了したか。「読み込み中の空」と「本当に0件」を UI が区別するために使う。 */
  isIndexReady: boolean;
  /**
   * 別名編集（U9）の結果を検索索引へ即時反映し、再検索を促す。
   * `SearchEngine.updateAliases`（メモリ内更新）を実行し、索引バージョンを進めて `results` を再計算させる。
   */
  updateAliases: (url: string, aliases: string[]) => void;
  /**
   * 現在の索引・クエリ・フォルダ絞り込みで `results` を再計算する（U10）。
   * インライン編集（`updateNode`）・削除（`removeNode`）・削除アンドゥ（`addNode`）等、
   * `SearchEngine` の索引をメモリ内更新した直後に呼び、再検索なしで表示へ即時反映する。
   */
  refresh: () => void;
}

/**
 * 検索フック（U7）。
 *
 * - 起動時に1回だけ `SearchEngine.loadIndex`（`getTree`/`getAll` → 索引構築）を実行する。
 * - `query` の変化に対し、`debounce 120ms` 後に U6 の同期 `search()` を実行する。
 * - `folderId` が指定されると、そのフォルダの直下のブックマークのみに絞り込む（左ペインのフォルダ選択＝スコープ）。
 *   「サブフォルダを含む」指定は持たない（直下のみ／「すべて」の2択）。検索ボックスのフォルダチップはスコープの
 *   可視化のみを担う（操作の主体ではない）。ツリーのキーボード操作・スコープ追従・展開永続は U11。空クエリは U6 のブラウズ（タイトル昇順）。
 */
export const useSearch = (query: string, folderId: string | null): UseSearchResult => {
  const [isIndexReady, setIsIndexReady] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [results, setResults] = useState<SearchResultItem[]>([]);

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

  // 現在の索引・クエリ・フォルダ絞り込みで同期検索を実行する（索引更新後の再検索にも共用する）。
  const runSearch = useCallback((): SearchResultItem[] => {
    if (!isIndexReady) {
      return [];
    }
    const keywords = debouncedQuery.trim().split(/\s+/).filter(Boolean);
    const folderScope = folderId ? { folderId } : undefined;
    return searchEngine.search({ keywords, folderScope });
  }, [debouncedQuery, isIndexReady, folderId]);

  // クエリ/フォルダ/索引準備の変化で再検索する。
  useEffect(() => {
    setResults(runSearch());
  }, [runSearch]);

  // 現在の索引・クエリ・フォルダ絞り込みで再検索し、results を最新化する（U10）。
  const refresh = useCallback(() => {
    setResults(runSearch());
  }, [runSearch]);

  // 別名編集の結果を索引へ反映（メモリ内更新）し、即座に再検索して表示を最新化する。
  // 永続化（AliasStore.upsert）は呼び出し側が行う。
  const updateAliases = useCallback(
    (url: string, aliases: string[]) => {
      searchEngine.updateAliases(url, aliases);
      refresh();
    },
    [refresh],
  );

  return { results, isIndexReady, updateAliases, refresh };
};
