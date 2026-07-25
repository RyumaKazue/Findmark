import '@src/Popup.css';
import { withErrorBoundary } from '@extension/shared';
import { ErrorDisplay } from '@extension/ui';
import { FolderTree } from '@src/components/FolderTree';
import { PopupShell } from '@src/components/PopupShell';
import { ResultList } from '@src/components/ResultList';
import { SearchHeader } from '@src/components/SearchHeader';
import { useSearch } from '@src/hooks/useSearch';
import { bookmarkService } from '@src/services';
import { useEffect, useState } from 'react';

/**
 * 検索ポップアップのルート（U7・デザイン状態1a）。
 *
 * U3〜U6 を結線し、起動→検索→開く の基本導線を成立させる。LIST 相当の最小挙動（↑↓/Enter/クリック）を
 * ローカル state で持つ（本格的なモード状態機械は U8 の `useMode` で巻き取る）。
 */
const Popup = () => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  // 左ペインで選択中のフォルダ（null = すべて）。配下（サブフォルダ含む）に絞り込む。
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const { results, isIndexReady } = useSearch(query, selectedFolderId);

  // クエリ or フォルダ選択が変わったら選択行を先頭へ戻す（docs/design: 絞り込み変更で focusedIndex=0）。
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, selectedFolderId]);

  // 結果件数が変わったら選択インデックスを範囲内へクランプする。
  useEffect(() => {
    setSelectedIndex(prev => Math.min(Math.max(0, prev), Math.max(0, results.length - 1)));
  }, [results.length]);

  const openAt = (index: number) => {
    const url = results[index]?.node.url;
    if (!url) {
      return;
    }
    // 現在タブで開く（UC-1）。破壊的操作ではないためロールバック不要、失敗はログのみ。
    bookmarkService.openUrl(url).catch((e: unknown) => console.error('[Popup] ブックマークを開けませんでした:', e));
  };

  const lastIndex = Math.max(0, results.length - 1);

  return (
    <PopupShell
      header={
        <SearchHeader
          query={query}
          onQueryChange={setQuery}
          onArrowDown={() => setSelectedIndex(i => Math.min(i + 1, lastIndex))}
          onArrowUp={() => setSelectedIndex(i => Math.max(i - 1, 0))}
          onEnter={() => openAt(selectedIndex)}
        />
      }
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
