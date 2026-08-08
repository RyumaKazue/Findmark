import { aliasStore, bookmarkService, searchEngine } from '../services.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SearchResultItem } from '@extension/shared';

/** インクリメンタル検索の debounce（docs/design「debounce 120ms 目安」）。 */
const DEBOUNCE_MS = 120;

export interface UseSearchResult {
  /** debounce 適用後の検索結果（U6 SearchEngine）。 */
  results: SearchResultItem[];
  /** 索引構築が完了したか。「読み込み中の空」と「本当に0件」を UI が区別するために使う。 */
  isIndexReady: boolean;
  /**
   * debounce 済みクエリが現在の `query` に追いついたか（= `results` が現在の `query`/`scope` を反映しているか）。
   * スコープ（`folderId`）は debounce しないため、真なら `results` は現在のクエリとスコープの両方を反映している。
   * U19 の状態復元で、保存された選択ブックマーク ID を「復元後クエリを反映した結果」に対して解決するためのゲートに使う
   * （debounce 中の旧結果に対して誤って解決し、先頭行へフォールバックしてしまう競合を防ぐ）。
   */
  isSettled: boolean;
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
  // 索引のメモリ内更新（別名編集・インライン編集・削除/アンドゥ）を results の再計算へ伝えるためのバージョン。
  const [indexVersion, setIndexVersion] = useState(0);

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

  // 検索は同期関数のため results はレンダー中に useMemo で導出する（state + effect の1レンダー遅延を作らない）。
  // これにより、索引構築完了（isIndexReady が true になる）と同じレンダーで results が確定し、U19 の選択復元が
  // 「まだ空の旧 results」に対して誤って先頭行へフォールバックしてしまう競合を防ぐ。索引のメモリ内更新は
  // indexVersion の変化で反映する（search() は純粋だが索引の内部状態が変わるため）。
  const results = useMemo<SearchResultItem[]>(() => {
    if (!isIndexReady) {
      return [];
    }
    const keywords = debouncedQuery.trim().split(/\s+/).filter(Boolean);
    const folderScope = folderId ? { folderId } : undefined;
    return searchEngine.search({ keywords, folderScope });
    // indexVersion は searchEngine の内部索引更新を results 再計算へ伝えるための依存（変数自体は本文で未使用）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, isIndexReady, folderId, indexVersion]);

  // 索引のメモリ内更新後に results を再計算させる（U10）。
  const refresh = useCallback(() => {
    setIndexVersion(v => v + 1);
  }, []);

  // 別名編集の結果を索引へ反映（メモリ内更新）し、即座に再計算して表示を最新化する。
  // 永続化（AliasStore.upsert）は呼び出し側が行う。
  const updateAliases = useCallback((url: string, aliases: string[]) => {
    searchEngine.updateAliases(url, aliases);
    setIndexVersion(v => v + 1);
  }, []);

  return { results, isIndexReady, isSettled: debouncedQuery === query, updateAliases, refresh };
};
