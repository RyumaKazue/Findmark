import '@src/Popup.css';
import { withErrorBoundary } from '@extension/shared';
import { ErrorDisplay } from '@extension/ui';
import { FolderTree } from '@src/components/FolderTree';
import { PopupShell } from '@src/components/PopupShell';
import { ResultList } from '@src/components/ResultList';
import { SearchHeader } from '@src/components/SearchHeader';
import { isPrintableKey, isSearchFirstExempt, resolveListEscape, resolveShortcutIntent } from '@src/hooks/modeMachine';
import { useMode } from '@src/hooks/useMode';
import { useSearch } from '@src/hooks/useSearch';
import { aliasStore, bookmarkService } from '@src/services';
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
  const { results, isIndexReady, updateAliases } = useSearch(query, selectedFolderId);
  const mode = useMode();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 別名編集（ALIAS_EDIT）の対象行。mode.targetId（node.id）から現在の結果を引く。
  const editingAliasId = mode.mode === 'ALIAS_EDIT' ? mode.targetId : null;
  const editingItem = editingAliasId ? (results.find(r => r.node.id === editingAliasId) ?? null) : null;

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

  const { enterAliasEdit, exitToList } = mode;

  // 別名編集に入る（選択行を対象にする）。対象行を選択インデックスへ合わせ、仮想スクロールで可視化する。
  // 既に別の行を別名編集中でも切り替えられるよう、一旦 LIST へ戻してから入り直す
  // （ENTER_ALIAS_EDIT は LIST からのみ有効。別行の別名/「＋別名」クリックで現在の入力が閉じて対象が移る）。
  const enterAliasEditAt = useCallback(
    (index: number) => {
      const id = results[index]?.node.id;
      if (!id) {
        return;
      }
      setSelectedIndex(index);
      exitToList();
      enterAliasEdit(id);
    },
    [results, exitToList, enterAliasEdit],
  );

  // 別名編集を終了し LIST に戻る。検索ファーストのため検索ボックスへフォーカスを戻す。
  const closeAliasEdit = useCallback(() => {
    exitToList();
    searchInputRef.current?.focus();
  }, [exitToList]);

  // 別名の永続化（AliasStore.upsert）＋検索索引への即時反映。編集対象の URL は mode.targetId から解決する。
  const commitAliases = useCallback(
    async (aliases: string[]) => {
      const url = editingItem?.node.url;
      if (!url) {
        return;
      }
      await aliasStore.upsert(url, aliases);
      updateAliases(url, aliases);
    },
    [editingItem, updateAliases],
  );

  // 編集対象が結果から消えた場合（検索条件変更等）は穏当に LIST へ戻す。
  useEffect(() => {
    if (mode.mode === 'ALIAS_EDIT' && editingItem === null) {
      exitToList();
    }
  }, [mode.mode, editingItem, exitToList]);

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
        // モード入口ショートカット（U8）。本単位では別名編集（Ctrl/Cmd+;）のみ結線する
        //（inline-edit=U10 / panel=U12 は該当単位で結線）。
        if (resolveShortcutIntent(e) === 'alias-edit' && results.length > 0) {
          e.preventDefault();
          enterAliasEditAt(selectedIndex);
          return;
        }
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
  }, [currentMode, resolveKey, lastIndex, selectedIndex, openAt, handleListEscape, enterAliasEditAt, results.length]);

  return (
    <PopupShell
      header={<SearchHeader query={query} onQueryChange={setQuery} inputRef={searchInputRef} />}
      sidebar={<FolderTree selectedFolderId={selectedFolderId} onSelectFolder={setSelectedFolderId} />}
      main={
        <ResultList
          results={results}
          selectedIndex={selectedIndex}
          emptyLabel={isIndexReady ? '一致するブックマークがありません' : '読み込み中…'}
          editingAliasId={editingAliasId}
          onOpen={openAt}
          onHover={setSelectedIndex}
          onEnterAliasEdit={enterAliasEditAt}
          onCommitAliases={commitAliases}
          onCloseAliasEdit={closeAliasEdit}
        />
      }
    />
  );
};

export default withErrorBoundary(Popup, ErrorDisplay);
