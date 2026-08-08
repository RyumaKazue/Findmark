import '@src/Popup.css';
import { withErrorBoundary } from '@extension/shared';
import { ErrorDisplay, cn } from '@extension/ui';
import { DragGhost } from '@src/components/DragGhost';
import { FolderTree } from '@src/components/FolderTree';
import { compressPath, findFolderPath } from '@src/components/folderTreeModel';
import { MovePanel } from '@src/components/MovePanel';
import { PopupShell } from '@src/components/PopupShell';
import { ResultList } from '@src/components/ResultList';
import { buildResultMetaLabel } from '@src/components/resultMetaModel';
import { SearchHeader } from '@src/components/SearchHeader';
import { Toast } from '@src/components/Toast';
import {
  isSearchFirstExempt,
  isSearchFirstTriggerKey,
  resolveEscapeStep,
  resolveShortcutIntent,
  toFocusArea,
} from '@src/hooks/modeMachine';
import {
  DEFAULT_SESSION,
  deriveSession,
  resolveRestoredIndex,
  resolveRestoredScope,
  sessionsEqual,
} from '@src/hooks/sessionModel';
import { useDragAndDrop } from '@src/hooks/useDragAndDrop';
import { useMode } from '@src/hooks/useMode';
import { useRowActions } from '@src/hooks/useRowActions';
import { useSearch } from '@src/hooks/useSearch';
import { useUndo } from '@src/hooks/useUndo';
import { aliasStore, bookmarkService, localStateStore } from '@src/services';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SearchResultItem } from '@extension/shared';
import type { PopupSession } from '@extension/storage';
import type { FolderTreeActions } from '@src/components/FolderTree';
import type { FolderTreeNode } from '@src/components/folderTreeModel';
import type { CommitPlan } from '@src/components/inlineEditModel';
import type { FocusArea, ListFocus } from '@src/hooks/modeMachine';

/** セッション保存の debounce（検索の 120ms より長くし、復元の選択解決が保存より先に走るようにする）。 */
const SESSION_SAVE_DEBOUNCE_MS = 200;

/**
 * 検索ポップアップのルート（U7 の3領域シェル + U8 のモード状態機械 + U8a のフォーカス3状態）。
 *
 * U8a で、フォーカスを検索ボックス/右ペイン/左ペインの3状態として扱う。`listFocus` は LIST モード内の
 * 検索ボックス/右ペインの別を表し、`FOLDER_TREE` モードは左ペインを表す（統合位置は `toFocusArea` で導出）。
 * LIST モードのキー意味論（↑↓/←→/Enter/段階Escape）は `modeMachine` の純粋関数が解決し、Popup は document
 * レベルの単一リスナーでそのインテントを実行する（フォーカスが左ペインのフォルダボタン等に移っていてもキー操作が
 * 一貫して効くようにするため）。編集/別名/パネル/ドラッグの各モードは UI 実体を持つ後続単位（U9/U10/U12/U13）が
 * `useMode` の遷移 API で接続する。左ペイン内の実ナビゲーション（フォルダ間移動・スコープ追従・展開トグル）は
 * U11 が `folderTreeActionsRef`（命令ハンドル）経由で結線する。
 *
 * 初期フォーカス（U11）: 起動時の既定フォーカスは**左ペイン**（`useMode('FOLDER_TREE')`）。左ペインが
 * キーボード操作可能になったため、U7 の「検索ボックスへ自動フォーカス」は廃止する。保存状態からの復元は U19。
 */
const Popup = () => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  // 左ペインのスコープ（null = すべて）。左ペインのフォーカス行でもあり、直下のみに絞り込む（U6a/U11）。
  const [scopeFolderId, setScopeFolderId] = useState<string | null>(null);
  // フォルダツリー（チップ/メタ行のパス解決に使う）。FolderTree が取得して渡す。
  const [folders, setFolders] = useState<FolderTreeNode[]>([]);
  // LIST モード内のフォーカス位置（検索ボックス/右ペイン）。既定フォーカスは左ペイン（FOLDER_TREE）のため、
  // LIST に入った初回は 'search' から始める。
  const [listFocus, setListFocus] = useState<ListFocus>('search');
  // 左ペインのキーボードインテント実行体（FolderTree が公開）。
  const folderTreeActionsRef = useRef<FolderTreeActions | null>(null);
  const { results, isIndexReady, isSettled, updateAliases, refresh } = useSearch(query, scopeFolderId);
  // U11: 起動時の既定フォーカスを左ペインにする。
  const mode = useMode('FOLDER_TREE');
  // ── U19: ポップアップ状態の復元 ──
  // 読み込んだセッション（未取得/失敗時は既定値）。復元適用の1回だけ参照するため ref で持つ。
  const sessionRef = useRef<PopupSession>(DEFAULT_SESSION);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  // フォルダツリー取得完了（スコープの存在検証を復元前に済ませるためのゲート）。
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  // 復元適用済みフラグ（保存 effect の解禁も兼ねる。復元前に既定値でセッションを潰さない）。
  const [hasRestored, setHasRestored] = useState(false);
  // 復元した選択ブックマーク ID の保留（索引・クエリが復元後結果を反映してから index へ解決する）。null = 保留なし。
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  // 復元クエリが残った状態で検索ファースト復帰したとき、既存クエリを全選択して次入力で置き換えるための保留（AC-11）。
  const restoredQuerySelectPendingRef = useRef(false);
  // 直近保存したセッション（無用な再書き込み・liveUpdate 通知を避ける等値比較用）。
  const lastSavedSessionRef = useRef<PopupSession | null>(null);
  // 現在の UI 状態から導出したセッションのスナップショット（pagehide フラッシュ用。毎レンダー更新）。
  // 閉じる直前の変更が debounce 待ちのまま失われるのを防ぐため、閉包の stale 値ではなく ref 越しに最新を読む。
  const sessionSnapshotRef = useRef<{ savable: boolean; session: PopupSession } | null>(null);
  const undo = useUndo();
  const rowActions = useRowActions(refresh, undo.register);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 別名編集（ALIAS_EDIT）の対象行。mode.targetId（node.id）から現在の結果を引く。
  const editingAliasId = mode.mode === 'ALIAS_EDIT' ? mode.targetId : null;
  const editingItem = editingAliasId ? (results.find(r => r.node.id === editingAliasId) ?? null) : null;

  // インライン編集（INLINE_EDIT）の対象行。mode.targetId（node.id）から現在の結果を引く（U10）。
  const editingInlineId = mode.mode === 'INLINE_EDIT' ? mode.targetId : null;
  const editingInlineItem = editingInlineId ? (results.find(r => r.node.id === editingInlineId) ?? null) : null;

  // クエリ or フォルダ選択が変わったら選択行を先頭へ戻す（docs/design: 絞り込み変更で focusedIndex=0）。
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, scopeFolderId]);

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

  const { enterFolderTree, enterAliasEdit, enterInlineEdit, enterPanel, enterDrag, exitToList } = mode;

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

  // U19: 復元したフォーカス位置を実際のモード/DOM フォーカスへ適用する。既定モードは FOLDER_TREE のため
  // 'folderTree' は通常現状維持（FolderTree の focused effect が DOM フォーカスを担う）。
  const applyFocusArea = useCallback(
    (area: FocusArea) => {
      if (area === 'folderTree') {
        enterFolderTree(); // 既に FOLDER_TREE なら reducer 側で no-op
        return;
      }
      exitToList();
      setListFocus(area);
      if (area === 'search') {
        searchInputRef.current?.focus();
      } else {
        searchInputRef.current?.blur();
      }
    },
    [enterFolderTree, exitToList],
  );

  // ユーザーによるクエリ編集。編集した時点で「復元クエリの全選択」保留は消費済みとして落とす（AC-11）。
  // 復元適用は生の setQuery を使うため、この保留は復元経路では落ちない。
  const handleQueryChange = useCallback((value: string) => {
    restoredQuerySelectPendingRef.current = false;
    setQuery(value);
  }, []);

  // フォルダツリー取得完了を親でも把握する（スコープの存在検証を復元前に済ませるゲート / U19）。
  const handleFoldersLoaded = useCallback((loaded: FolderTreeNode[]) => {
    setFolders(loaded);
    setFoldersLoaded(true);
  }, []);

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

  // インライン編集に入る（選択行を対象にする）。別名編集と同じパターン（U10）。
  const enterInlineEditAt = useCallback(
    (index: number) => {
      const id = results[index]?.node.id;
      if (!id) {
        return;
      }
      setSelectedIndex(index);
      exitToList();
      enterInlineEdit(id);
    },
    [results, exitToList, enterInlineEdit],
  );

  // インライン編集の確定内容を反映し LIST へ戻る。InlineEdit は不正な URL では onCommit を
  // 呼ばない（コンポーネント内に留まる）ため、ここに来る plan は 'update'/'unchanged' のみ。
  const handleCommitEdit = useCallback(
    (plan: CommitPlan) => {
      if (editingInlineItem) {
        void rowActions.commitEdit(editingInlineItem, plan);
      }
      focusSearch();
    },
    [editingInlineItem, rowActions, focusSearch],
  );

  // インライン編集を破棄して LIST へ戻る（変更は保存しない）。
  const handleCancelEdit = useCallback(() => {
    focusSearch();
  }, [focusSearch]);

  // 行を削除する（アンドゥはトースト/Ctrl+Z から発動する）。
  const handleDeleteAt = useCallback(
    (index: number) => {
      const item = results[index];
      if (!item) {
        return;
      }
      void rowActions.deleteRow(item);
    },
    [results, rowActions],
  );

  // インライン編集の対象が結果から消えた場合（検索条件変更等）は穏当に LIST へ戻す。
  useEffect(() => {
    if (mode.mode === 'INLINE_EDIT' && editingInlineItem === null) {
      exitToList();
    }
  }, [mode.mode, editingInlineItem, exitToList]);

  // ── U12: フォルダ移動（MovePanel / ドラッグ&ドロップ） ──

  // 移動先フォルダ ID からフルパスを解決して移動する（D&D のドロップから呼ぶ）。
  const performMove = useCallback(
    (item: SearchResultItem, folderId: string) => {
      void rowActions.moveRow(item, folderId, findFolderPath(folders, folderId));
    },
    [folders, rowActions],
  );

  // D&D 結線。ドロップ先の自動展開（スプリングロード）は左ペインの命令ハンドル経由（キーボードと同じ経路）。
  const dnd = useDragAndDrop({
    enterDrag,
    exitToList,
    onDrop: performMove,
    springLoad: useCallback((folderId: string) => folderTreeActionsRef.current?.expand(folderId), []),
  });

  // フォルダ選択パネル（Ctrl+M）の対象行。開いた時点の選択行を対象にする（パネル操作中は選択行が動かない）。
  const movePanelItem = mode.mode === 'PANEL' ? (results[selectedIndex] ?? null) : null;

  // パネル表示中に対象行が消えたら穏当に閉じる（別名/インライン編集と同じパターン）。
  useEffect(() => {
    if (mode.mode === 'PANEL' && movePanelItem === null) {
      exitToList();
    }
  }, [mode.mode, movePanelItem, exitToList]);

  // パネルでフォルダを確定 → 移動して検索ボックスへ戻る（フルパスは候補が保持している値をそのまま使う）。
  const handleMoveConfirm = useCallback(
    (folderId: string, folderPath: string[]) => {
      if (movePanelItem) {
        void rowActions.moveRow(movePanelItem, folderId, folderPath);
      }
      focusSearch();
    },
    [movePanelItem, rowActions, focusSearch],
  );

  // Escape を1段階ずつ解決する（U8a: 検索ボックスへ戻る → キーワードクリア → フォルダ絞り込み解除 → 閉じる）。
  const currentFocusArea = toFocusArea(mode.mode, listFocus);
  const handleEscapeStep = useCallback(() => {
    const step = resolveEscapeStep({
      focusArea: currentFocusArea,
      hasQuery: query.trim().length > 0,
      hasScope: scopeFolderId !== null,
    });
    if (step === 'focus-search') {
      focusSearch();
    } else if (step === 'clear-keyword') {
      setQuery('');
    } else if (step === 'clear-scope') {
      setScopeFolderId(null);
    } else {
      window.close();
    }
  }, [currentFocusArea, query, scopeFolderId, focusSearch]);

  // モード状態機械に基づくキー操作を document レベルで一元処理する。
  // 検索ボックス外（左ペインのフォルダボタン等）にフォーカスがあっても LIST/FOLDER_TREE のキー操作が一貫して効く。
  const { mode: currentMode, resolveKey } = mode;
  const { pending: undoPending, undoLatest } = undo;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // IME 変換確定の Enter/Escape 等を操作として扱わない（誤確定・誤クローズ防止）。
      if (e.isComposing) {
        return;
      }
      const input = searchInputRef.current;
      const inInput = input !== null && e.target === input;

      // アンドゥ（Ctrl/Cmd+Z）はトースト表示中（保持あり）のときのみ乗っ取る。ただし自前の
      // 文字入力 UI を持つモード（INLINE_EDIT/ALIAS_EDIT/PANEL）ではネイティブの取り消し
      // （フォーム内テキストの入力取り消し）を優先し、乗っ取らない（`isSearchFirstExempt` と
      // 同じ判定を再利用。実装検証で「削除直後5秒以内に別行を編集し始めた場合、編集中の
      // テキスト取り消しのつもりの Ctrl+Z が無関係な削除の復元を誤発動させる」懸念が指摘されたため）。
      // 保持が無ければ何もせずネイティブの取り消しに委ねる（U10）。
      if (resolveShortcutIntent(e) === 'undo' && undoPending && !isSearchFirstExempt(currentMode)) {
        e.preventDefault();
        undoLatest();
        return;
      }

      if (currentMode === 'LIST') {
        // モード入口/行操作ショートカット（U8・U10）。
        const shortcutIntent = resolveShortcutIntent(e);
        if (shortcutIntent === 'alias-edit' && results.length > 0) {
          e.preventDefault();
          enterAliasEditAt(selectedIndex);
          return;
        }
        if (shortcutIntent === 'inline-edit' && results.length > 0) {
          e.preventDefault();
          enterInlineEditAt(selectedIndex);
          return;
        }
        // Ctrl(Cmd)+M: フォルダ選択パネルを開く（対象は選択行・U12）。
        if (shortcutIntent === 'panel' && results.length > 0) {
          e.preventDefault();
          enterPanel();
          return;
        }
        // 検索ボックスにフォーカスがある間の Delete は文字の前方削除のまま（ブックマークを削除しない）。
        if (shortcutIntent === 'delete' && listFocus === 'result' && results.length > 0) {
          e.preventDefault();
          handleDeleteAt(selectedIndex);
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
            e.preventDefault();
            folderTreeActionsRef.current?.moveFocus(-1);
            return;
          case 'folder:move-down':
            e.preventDefault();
            folderTreeActionsRef.current?.moveFocus(1);
            return;
          case 'folder:parent':
            e.preventDefault();
            folderTreeActionsRef.current?.focusParent();
            return;
          case 'folder:toggle-expand':
            e.preventDefault();
            folderTreeActionsRef.current?.toggleExpand();
            return;
          case 'folder:home':
            e.preventDefault();
            folderTreeActionsRef.current?.focusAll();
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
        // AC-11: 復元クエリが残っていれば全選択し、この印字文字（keydown の既定動作）で置き換わるようにする。
        if (restoredQuerySelectPendingRef.current) {
          input.select();
          restoredQuerySelectPendingRef.current = false;
        }
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
    enterInlineEditAt,
    handleDeleteAt,
    enterFolderTree,
    enterPanel,
    exitToList,
    leaveSearch,
    focusSearch,
    results.length,
    undoPending,
    undoLatest,
  ]);

  // ── U19: 状態の保存と復元 ──

  // 起動時に1回だけ保存済みセッションを読み込む（失敗時は既定値のまま継続 = 入力を阻害しない）。
  useEffect(() => {
    let active = true;
    localStateStore
      .get()
      .then(state => {
        if (active) {
          sessionRef.current = state.session ?? DEFAULT_SESSION;
        }
      })
      .catch((e: unknown) => console.error('[Popup] セッションの読み込みに失敗しました:', e))
      .finally(() => {
        if (active) {
          setSessionLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // 復元適用（1回のみ）。フォーカス/スコープ/クエリは索引を必要としないため、セッション読込とフォルダ取得が
  // 揃った時点で即適用する（数ms〜数十ms）。索引構築（~数百ms）を待たないことで、既定状態（左ペインフォーカス＋
  // スコープ「すべて」）が索引完了まで見えてしまうフラッシュを避ける（AC-10）。選択行の ID→index 解決だけは
  // 索引・結果が要るため、下の別 effect で `isIndexReady`/`isSettled` を待って行う。
  useEffect(() => {
    if (hasRestored || !sessionLoaded || !foldersLoaded) {
      return;
    }
    const session = sessionRef.current;
    // スコープ: 保存フォルダが現存しなければ「すべて」へフォールバック（AC-5）。focusArea はこの結果に影響されない。
    const scopeExists = session.scopeFolderId !== null && findFolderPath(folders, session.scopeFolderId).length > 0;
    setScopeFolderId(resolveRestoredScope(session.scopeFolderId, scopeExists));
    setQuery(session.query); // 生の setQuery（復元経路は全選択保留を落とさない）
    applyFocusArea(session.focusArea); // フォーカスは保存値のまま復元（AC-7）
    setPendingSelectId(session.selectedBookmarkId ?? null); // 選択は結果が揃ってから ID→index 解決
    // 復元クエリが残り、かつフォーカスが検索ボックス以外なら、印字文字での復帰時に全選択させる（AC-11）。
    restoredQuerySelectPendingRef.current = session.query !== '' && session.focusArea !== 'search';
    setHasRestored(true);
  }, [hasRestored, sessionLoaded, foldersLoaded, folders, applyFocusArea]);

  // 復元した選択ブックマーク ID を index へ解決（AC-6/AC-8）。isSettled で「復元後クエリを反映した結果」に対して行う。
  useEffect(() => {
    if (pendingSelectId === null || !isIndexReady || !isSettled) {
      return;
    }
    setSelectedIndex(
      resolveRestoredIndex(
        pendingSelectId,
        results.map(r => r.node.id),
      ),
    );
    setPendingSelectId(null);
  }, [pendingSelectId, isIndexReady, isSettled, results]);

  // 現在の UI 状態から保存対象セッションを導出（毎レンダー）。復元完了かつ選択解決済みのときだけ「保存可（savable）」。
  // 復元した選択の ID→index 解決が保留中（`pendingSelectId !== null`）の間は保存しない。フォーカス/スコープ/クエリの
  // 復元を索引構築より前に行うため、この間 `results` はまだ空で `selectedBookmarkId` が拾えず、保存すると保存済みの
  // 選択 ID を空で上書き（クロバー）してしまう。解決完了（または元から選択なし = null）まで待つ。
  const currentSession = deriveSession({
    focusArea: currentFocusArea,
    scopeFolderId,
    selectedBookmarkId: results[selectedIndex]?.node.id,
    query,
  });
  const isSessionSavable = hasRestored && pendingSelectId === null;
  sessionSnapshotRef.current = { savable: isSessionSavable, session: currentSession };

  // 直近保存と等値でなければ保存する共通処理。debounce フラッシュ（変更時）と pagehide フラッシュ（閉じる時）で共用。
  const persistSession = useCallback((session: PopupSession) => {
    if (lastSavedSessionRef.current && sessionsEqual(lastSavedSessionRef.current, session)) {
      return;
    }
    lastSavedSessionRef.current = session;
    void localStateStore
      .saveSession(session)
      .catch((e: unknown) => console.error('[Popup] セッションの保存に失敗しました:', e));
  }, []);

  // 状態保存（debounce 付き）。変更のたびに再スケジュールし、直近保存と等値なら書き込まない（AC-3）。
  const currentSessionKey = JSON.stringify(currentSession);
  useEffect(() => {
    if (!isSessionSavable) {
      return;
    }
    const id = setTimeout(() => persistSession(currentSession), SESSION_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // currentSession は毎レンダー新規オブジェクトのため、内容の等価判定用に currentSessionKey を依存に使う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSessionSavable, currentSessionKey, persistSession]);

  // 閉じる直前のフラッシュ（AC-3）。ポップアップは外側クリックで唐突に閉じるため、debounce 待ちの最終変更が
  // 失われないよう、hidden/pagehide で最新スナップショットを即時（debounce なしで）保存する。
  useEffect(() => {
    const flush = () => {
      const snap = sessionSnapshotRef.current;
      if (snap?.savable) {
        persistSession(snap.session);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [persistSession]);

  // INLINE_EDIT 中はヘッダーと左ペインを dimmed にする（デザイン状態1d。docs/design「他要素: opacity 0.45」）。
  const dimHeaderAndSidebar = mode.mode === 'INLINE_EDIT';

  // スコープの可視化用パス（圧縮済み・配列で保持し表示時のみ結合 = AC-6/AC-7）。フォルダ未解決時は null に倒す。
  const scopePath = useMemo(() => {
    if (scopeFolderId === null) {
      return null;
    }
    const path = findFolderPath(folders, scopeFolderId);
    return path.length > 0 ? compressPath(path) : null;
  }, [folders, scopeFolderId]);

  // 右ペインのメタ行文言（U11。クエリなし & スコープ「すべて」では null = メタ行なし）。
  const metaLabel = buildResultMetaLabel({ scopePath, query: query.trim(), count: results.length });

  return (
    <div className="relative">
      <PopupShell
        header={
          <div className={dimHeaderAndSidebar ? 'opacity-45' : undefined}>
            <SearchHeader
              query={query}
              onQueryChange={handleQueryChange}
              inputRef={searchInputRef}
              scopePath={scopePath}
            />
          </div>
        }
        sidebar={
          // アクティブペイン枠（AC-14）: ペインの最外周に重ねる「一番外側の枠」。選択行・スコープ塗りが
          // 枠の外へはみ出さないよう inset-0（端ぴったり）に置き、下角のみポップアップの角丸（xl）に合わせて
          // クリップを回避する。pointer-events-none でクリックも妨げない。
          <div className={cn('relative h-full', dimHeaderAndSidebar && 'opacity-45')}>
            <FolderTree
              scopeFolderId={scopeFolderId}
              onScopeChange={setScopeFolderId}
              focused={mode.mode === 'FOLDER_TREE'}
              onActivate={enterFolderTree}
              onFoldersLoaded={handleFoldersLoaded}
              actionsRef={folderTreeActionsRef}
              dropTargetId={dnd.dropTargetId}
              ready={hasRestored}
            />
            {currentFocusArea === 'folderTree' && (
              <div
                aria-hidden="true"
                className="border-accent pointer-events-none absolute inset-0 rounded-bl-xl border-2"
              />
            )}
          </div>
        }
        main={
          <div className="relative h-full">
            <ResultList
              results={results}
              selectedIndex={selectedIndex}
              emptyLabel={isIndexReady ? '一致するブックマークがありません' : '読み込み中…'}
              metaLabel={metaLabel}
              resultFocused={currentFocusArea === 'result'}
              editingAliasId={editingAliasId}
              editingInlineId={editingInlineId}
              onOpen={openAt}
              onHover={setSelectedIndex}
              onEnterAliasEdit={enterAliasEditAt}
              onCommitAliases={commitAliases}
              onCloseAliasEdit={closeAliasEdit}
              onEnterInlineEdit={enterInlineEditAt}
              onCommitEdit={handleCommitEdit}
              onCancelEdit={handleCancelEdit}
              onDeleteRow={handleDeleteAt}
              onRowMouseDown={(index, e) => dnd.onRowMouseDown(results[index], e)}
            />
            {currentFocusArea === 'result' && (
              <div
                aria-hidden="true"
                className="border-accent pointer-events-none absolute inset-0 rounded-br-xl border-2"
              />
            )}
          </div>
        }
      />
      {/* フォルダ選択パネル（Ctrl+M・U12）。対象行があるときのみ描画する。 */}
      {mode.mode === 'PANEL' && movePanelItem && (
        <MovePanel
          folders={folders}
          currentParentId={movePanelItem.node.parentId ?? null}
          onConfirm={handleMoveConfirm}
          onClose={focusSearch}
        />
      )}
      {/* ドラッグ中のゴースト（U12）。カーソル追従の浮遊カード。 */}
      {dnd.dragging && (
        <DragGhost
          title={dnd.dragging.node.title}
          url={dnd.dragging.node.url ?? ''}
          count={1}
          x={dnd.ghostPos.x}
          y={dnd.ghostPos.y}
        />
      )}
      {undo.pending ? (
        <Toast message={undo.pending.label} actionLabel="元に戻す" onAction={undoLatest} onDismiss={undo.dismiss} />
      ) : rowActions.error ? (
        <Toast message={rowActions.error} onDismiss={rowActions.clearError} tone="danger" />
      ) : null}
    </div>
  );
};

export default withErrorBoundary(Popup, ErrorDisplay);
