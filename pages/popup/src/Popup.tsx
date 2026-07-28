import '@src/Popup.css';
import { withErrorBoundary } from '@extension/shared';
import { ErrorDisplay } from '@extension/ui';
import { FolderTree } from '@src/components/FolderTree';
import { PopupShell } from '@src/components/PopupShell';
import { ResultList } from '@src/components/ResultList';
import { SearchHeader } from '@src/components/SearchHeader';
import {
  isSearchFirstExempt,
  isSearchFirstTriggerKey,
  resolveEscapeStep,
  resolveShortcutIntent,
  toFocusArea,
} from '@src/hooks/modeMachine';
import { useMode } from '@src/hooks/useMode';
import { useSearch } from '@src/hooks/useSearch';
import { aliasStore, bookmarkService } from '@src/services';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListFocus } from '@src/hooks/modeMachine';

/**
 * 検索ポップアップのルート（U7 の3領域シェル + U8 のモード状態機械 + U8a のフォーカス3状態）。
 *
 * U8a で、フォーカスを検索ボックス/右ペイン/左ペインの3状態として扱う。`listFocus` は LIST モード内の
 * 検索ボックス/右ペインの別を表し、`FOLDER_TREE` モードは左ペインを表す（統合位置は `toFocusArea` で導出）。
 * LIST モードのキー意味論（↑↓/←→/Enter/段階Escape）は `modeMachine` の純粋関数が解決し、Popup は document
 * レベルの単一リスナーでそのインテントを実行する（フォーカスが左ペインのフォルダボタン等に移っていてもキー操作が
 * 一貫して効くようにするため）。編集/別名/パネル/ドラッグの各モードは UI 実体を持つ後続単位（U9/U10/U12/U13）が
 * `useMode` の遷移 API で接続する。左ペイン内の実ナビゲーション（フォルダ間移動・スコープ追従・展開トグル）は
 * U11 が結線する（本単位はインテントの定義とペイン間移動のみ）。
 *
 * 初期フォーカス: PRD では起動時の既定は左ペインだが、左ペインがキー操作可能になるのは U11 のため、
 * 本単位では暫定的に `listFocus='search'` を初期値とする（`↑↓` が無反応なペインへ着地させないため）。
 * U11 が既定値の切り替えを、U19 が保存状態からの復元を担う。
 */
const Popup = () => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  // 左ペインで選択中のフォルダ（null = すべて）。直下のみに絞り込む（U6a）。
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  // LIST モード内のフォーカス位置（検索ボックス/右ペイン）。暫定初期値は 'search'（上記 JSDoc 参照）。
  const [listFocus, setListFocus] = useState<ListFocus>('search');
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

  const { enterFolderTree, enterAliasEdit, exitToList } = mode;

  // 検索ボックスへフォーカスを戻す（FOLDER_TREE からの復帰も兼ねる）。検索ファースト復帰・Escape の
  // 1段目・別名編集終了などから共通で呼ばれる（U8a）。
  const focusSearch = useCallback(() => {
    exitToList();
    setListFocus('search');
    searchInputRef.current?.focus();
  }, [exitToList]);

  // 検索欄を離脱し、同時に選択行を1つ動かす（U8a）。blur() でキャレットを外すことで、以降 ←→ を
  // ペイン移動に使えるようにする（検索ボックスにフォーカスがある間は ←→ をキャレット移動専用に保つため）。
  const leaveSearch = useCallback(
    (delta: -1 | 1) => {
      setListFocus('result');
      searchInputRef.current?.blur();
      setSelectedIndex(i => Math.min(Math.max(i + delta, 0), lastIndex));
    },
    [lastIndex],
  );

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
    focusSearch();
  }, [focusSearch]);

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

  // Escape を1段階ずつ解決する（U8a: 検索ボックスへ戻る → キーワードクリア → フォルダ絞り込み解除 → 閉じる）。
  const currentFocusArea = toFocusArea(mode.mode, listFocus);
  const handleEscapeStep = useCallback(() => {
    const step = resolveEscapeStep({
      focusArea: currentFocusArea,
      hasQuery: query.trim().length > 0,
      hasScope: selectedFolderId !== null,
    });
    if (step === 'focus-search') {
      focusSearch();
    } else if (step === 'clear-keyword') {
      setQuery('');
    } else if (step === 'clear-scope') {
      setSelectedFolderId(null);
    } else {
      window.close();
    }
  }, [currentFocusArea, query, selectedFolderId, focusSearch]);

  // モード状態機械に基づくキー操作を document レベルで一元処理する。
  // 検索ボックス外（左ペインのフォルダボタン等）にフォーカスがあっても LIST/FOLDER_TREE のキー操作が一貫して効く。
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
        const intent = resolveKey(e, listFocus);
        switch (intent) {
          case 'list:leave-search-up':
            e.preventDefault();
            leaveSearch(-1);
            return;
          case 'list:leave-search-down':
            e.preventDefault();
            leaveSearch(1);
            return;
          case 'list:move-up':
            e.preventDefault();
            setSelectedIndex(i => Math.max(i - 1, 0));
            return;
          case 'list:move-down':
            e.preventDefault();
            setSelectedIndex(i => Math.min(i + 1, lastIndex));
            return;
          case 'list:to-folder-tree':
            e.preventDefault();
            enterFolderTree();
            return;
          case 'list:open':
            // フォーカスが左ペインのフォルダボタン等にある場合はネイティブの活性化に委ねる。
            if (!inInput && (e.target as HTMLElement | null)?.closest('button')) {
              return;
            }
            e.preventDefault();
            openAt(selectedIndex);
            return;
          case 'escape:step-back':
            e.preventDefault();
            handleEscapeStep();
            return;
          default:
            break;
        }
      } else if (currentMode === 'FOLDER_TREE') {
        const intent = resolveKey(e, listFocus);
        switch (intent) {
          case 'folder:to-result':
            e.preventDefault();
            exitToList();
            setListFocus('result');
            return;
          case 'escape:step-back':
            e.preventDefault();
            handleEscapeStep();
            return;
          case 'folder:move-up':
          case 'folder:move-down':
          case 'folder:parent':
          case 'folder:toggle-expand':
          case 'folder:home':
            // 左ペイン内の実ナビゲーションは U11 が結線する（本単位はインテントの定義のみ）。
            return;
          default:
            break;
        }
      }

      // 検索ファースト復帰: 編集/パネルモード以外で、検索ボックス外にフォーカスがある状態で印字文字または
      // Backspace を打つと検索ボックスへフォーカスを戻す（functional-design「共通ルール」。左ペインからの
      // 復帰も含む）。スペースは検索開始文字にしない（かつフォーカス中ボタンの活性化キーのため）ので除外する。
      if (
        !isSearchFirstExempt(currentMode) &&
        input !== null &&
        !inInput &&
        e.key !== ' ' &&
        isSearchFirstTriggerKey({
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          isComposing: e.isComposing,
        })
      ) {
        focusSearch();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    currentMode,
    listFocus,
    resolveKey,
    lastIndex,
    selectedIndex,
    openAt,
    handleEscapeStep,
    enterAliasEditAt,
    enterFolderTree,
    exitToList,
    leaveSearch,
    focusSearch,
    results.length,
  ]);

  return (
    <PopupShell
      header={<SearchHeader query={query} onQueryChange={setQuery} inputRef={searchInputRef} />}
      sidebar={
        <div className={mode.mode === 'FOLDER_TREE' ? 'shadow-focus-ring h-full rounded-md' : 'h-full'}>
          <FolderTree selectedFolderId={selectedFolderId} onSelectFolder={setSelectedFolderId} />
        </div>
      }
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
