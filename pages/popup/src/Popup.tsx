import '@src/Popup.css';
import { withErrorBoundary } from '@extension/shared';
import { ErrorDisplay } from '@extension/ui';
import { FolderTree } from '@src/components/FolderTree';
import { PopupShell } from '@src/components/PopupShell';
import { ResultList } from '@src/components/ResultList';
import { SearchHeader } from '@src/components/SearchHeader';
import { isPrintableKey, isSearchFirstExempt, resolveListEscape } from '@src/hooks/modeMachine';
import { useMode } from '@src/hooks/useMode';
import { useSearch } from '@src/hooks/useSearch';
import { bookmarkService } from '@src/services';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 検索ポップアップのルート（U7 の3領域シェル + U8 のモード状態機械）。
 *
 * U8 で、暫定のローカルキー処理を `useMode` に置き換える。LIST モードのキー意味論（↑↓/Enter/段階Escape）は
 * `modeMachine` の純粋関数が解決し、Popup は document レベルの単一リスナーでそのインテントを実行する
 * （フォーカスが左ペインのフォルダボタン等に移っていてもキー操作が一貫して効くようにするため）。
 * 編集/別名/パネル/ドラッグの各モードは UI 実体を持つ後続単位（U9/U10/U12/U13）が `useMode` の遷移 API で接続する。
 */
const Popup = () => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  // 左ペインで選択中のフォルダ（null = すべて）。配下（サブフォルダ含む）に絞り込む。
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const { results, isIndexReady } = useSearch(query, selectedFolderId);
  const mode = useMode();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // クエリ or フォルダ選択が変わったら選択行を先頭へ戻す（docs/design: 絞り込み変更で focusedIndex=0）。
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, selectedFolderId]);

  // 結果件数が変わったら選択インデックスを範囲内へクランプする。
  useEffect(() => {
    setSelectedIndex(prev => Math.min(Math.max(0, prev), Math.max(0, results.length - 1)));
  }, [results.length]);

  const lastIndex = Math.max(0, results.length - 1);

  const openAt = useCallback(
    (index: number) => {
      const url = results[index]?.node.url;
      if (!url) {
        return;
      }
      // 現在タブで開く（UC-1）。破壊的操作ではないためロールバック不要、失敗はログのみ。
      bookmarkService.openUrl(url).catch((e: unknown) => console.error('[Popup] ブックマークを開けませんでした:', e));
    },
    [results],
  );

  // LIST の Escape を1段階ずつ解決する（キーワードクリア → フォルダ絞り込み解除 → 閉じる）。
  const handleListEscape = useCallback(() => {
    const action = resolveListEscape({ hasQuery: query.trim().length > 0, hasScope: selectedFolderId !== null });
    if (action === 'clear-keyword') {
      setQuery('');
    } else if (action === 'clear-scope') {
      setSelectedFolderId(null);
    } else {
      window.close();
    }
  }, [query, selectedFolderId]);

  // モード状態機械に基づくキー操作を document レベルで一元処理する。
  // 検索ボックス外（左ペインのフォルダボタン等）にフォーカスがあっても LIST のキー操作が一貫して効く。
  const { mode: currentMode, resolveKey } = mode;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // IME 変換確定の Enter/Escape 等を操作として扱わない（誤確定・誤クローズ防止）。
      if (e.isComposing) {
        return;
      }
      const input = searchInputRef.current;
      const inInput = input !== null && e.target === input;

      if (currentMode === 'LIST') {
        const intent = resolveKey(e);
        switch (intent) {
          case 'list:move-down':
            e.preventDefault();
            setSelectedIndex(i => Math.min(i + 1, lastIndex));
            return;
          case 'list:move-up':
            e.preventDefault();
            setSelectedIndex(i => Math.max(i - 1, 0));
            return;
          case 'list:open':
            // フォーカスが左ペインのフォルダボタン等にある場合はネイティブの活性化に委ねる。
            if (!inInput && (e.target as HTMLElement | null)?.closest('button')) {
              return;
            }
            e.preventDefault();
            openAt(selectedIndex);
            return;
          case 'list:escape':
            e.preventDefault();
            handleListEscape();
            return;
          default:
            break;
        }
      }

      // 検索ファースト復帰: 編集/パネルモード以外で、検索ボックス外にフォーカスがある状態で印字文字を打つと
      // 検索ボックスへフォーカスを戻す（functional-design「共通ルール」）。
      // スペースは検索開始文字にしない（かつフォーカス中ボタンの活性化キーのため）ので除外する。
      if (
        !isSearchFirstExempt(currentMode) &&
        input !== null &&
        !inInput &&
        e.key !== ' ' &&
        isPrintableKey({
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          isComposing: e.isComposing,
        })
      ) {
        input.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [currentMode, resolveKey, lastIndex, selectedIndex, openAt, handleListEscape]);

  return (
    <PopupShell
      header={<SearchHeader query={query} onQueryChange={setQuery} inputRef={searchInputRef} />}
      sidebar={<FolderTree selectedFolderId={selectedFolderId} onSelectFolder={setSelectedFolderId} />}
      main={
        <ResultList
          results={results}
          selectedIndex={selectedIndex}
          emptyLabel={isIndexReady ? '一致するブックマークがありません' : '読み込み中…'}
          onOpen={openAt}
          onHover={setSelectedIndex}
        />
      }
    />
  );
};

export default withErrorBoundary(Popup, ErrorDisplay);
