import { FolderTreeItem } from './FolderTreeItem.js';
import {
  buildFolderTree,
  collectAncestorIds,
  findParentId,
  flattenVisibleTree,
  moveRow,
  rowKey,
} from './folderTreeModel.js';
import { bookmarkService, localStateStore } from '../services.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FolderTreeNode, TreeRow } from './folderTreeModel.js';
import type { RefObject } from 'react';

/** Popup の document リスナーから呼ばれる左ペイン操作（U8a の `folder:*` インテントの実行体）。 */
interface FolderTreeActions {
  /** `folder:move-up` / `folder:move-down`。可視行を1つ移動しスコープを追従させる。 */
  moveFocus: (delta: -1 | 1) => void;
  /** `folder:parent`。親フォルダへ移動（最上位・「すべて」では何もしない）。 */
  focusParent: () => void;
  /** `folder:toggle-expand`。フォルダの展開トグル（「さらに N 件…」行では残りを表示）。 */
  toggleExpand: () => void;
  /** `folder:home`。スコープを「すべて」へ一発で戻す。 */
  focusAll: () => void;
  /** D&D のスプリングロード（閉じたフォルダのホバー自動展開・U12）。既に展開済みなら何もしない。 */
  expand: (id: string) => void;
}

interface FolderTreeProps {
  /** 現在のスコープ（null = すべて）。左ペインのフォーカス行でもある。 */
  scopeFolderId: string | null;
  /** スコープ変更（キーボード移動・フォルダ名クリックの両方から呼ばれる）。 */
  onScopeChange: (id: string | null) => void;
  /** 左ペインがフォーカスされているか（mode === 'FOLDER_TREE'）。 */
  focused: boolean;
  /** ツリー内をクリックした際に左ペイン（FOLDER_TREE）へ入る（mode 遷移は Popup が担う）。 */
  onActivate: () => void;
  /** 取得したフォルダツリーを親へ渡す（チップ/メタ行のパス解決に使う）。 */
  onFoldersLoaded: (folders: FolderTreeNode[]) => void;
  /** キーボードインテントを受け取るための命令ハンドル。 */
  actionsRef: RefObject<FolderTreeActions | null>;
  /** D&D のドロップ先候補フォルダ ID（破線ハイライト・U12）。null = ハイライトなし。 */
  dropTargetId?: string | null;
  /**
   * 行を描画してよいか（U19）。`false` の間は行を描画しない（フォルダ取得は継続する）。
   * 状態復元（スコープ）が当たる前に既定スコープ「すべて」で行を描画してしまうと、起動直後に一瞬「すべて」が
   * ハイライトされてから保存スコープへ移る見た目のフラッシュになる。復元適用が済むまで行の描画を保留して防ぐ。
   */
  ready?: boolean;
}

/** `folders` から ID でノードを引く（純粋・小さいため FolderTree ローカルに閉じる）。 */
const findNode = (nodes: FolderTreeNode[], id: string): FolderTreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = findNode(node.children, id);
    if (found) {
      return found;
    }
  }
  return null;
};

/**
 * 左ペイン（220px）のフォルダツリー（U11）。キーボード操作可能なスコープ選択面。
 *
 * 状態は「スコープ = フォーカス行」に畳んで二重管理を消す（scopeFolderId は Popup が保持）。展開状態は
 * `localStateStore` に永続化し、「さらに N 件…」の残り表示（revealedIds）はポップアップを開くたびリセットする。
 * キー処理は Popup の単一 document リスナーが担い、実行だけを `actionsRef`（命令ハンドル）で受ける。
 * マウスクリックとキーボードは同じ `scopeFolderId` を更新し、クリック後はツリールートへ DOM フォーカスを戻す
 * ことで内部モデルと実 DOM フォーカスを常に一致させる（AC-8）。
 */
export const FolderTree = ({
  scopeFolderId,
  onScopeChange,
  focused,
  onActivate,
  onFoldersLoaded,
  actionsRef,
  dropTargetId = null,
  ready = true,
}: FolderTreeProps) => {
  const [folders, setFolders] = useState<FolderTreeNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // 「さらに N 件…」で残りを表示した親フォルダ ID（非永続。開くたびリセット）。
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  // 「さらに N 件…」行にフォーカスがあるときのみ非 null（スコープと一致しない唯一の例外）。
  const [focusedMoreParentId, setFocusedMoreParentId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  // 行キー → ref コールバックのキャッシュ（identity を安定させ ref の不要な着脱を避ける）。
  const refCallbackCache = useRef<Map<string, (el: HTMLElement | null) => void>>(new Map());

  // 起動時: フォルダツリーと展開状態を並行取得。初回は最上位フォルダを既定展開にする。
  useEffect(() => {
    let active = true;
    Promise.all([bookmarkService.getTree(), localStateStore.get()])
      .then(([tree, local]) => {
        if (!active) {
          return;
        }
        const built = buildFolderTree(tree);
        setFolders(built);
        onFoldersLoaded(built);
        if (local.isExpandedInitialized) {
          setExpandedIds(new Set(local.expandedFolderIds));
        } else {
          const topIds = built.map(f => f.id);
          setExpandedIds(new Set(topIds));
          void localStateStore.initializeExpanded(topIds);
        }
      })
      .catch((e: unknown) => console.error('[FolderTree] フォルダツリーの取得に失敗しました:', e));
    return () => {
      active = false;
    };
  }, [onFoldersLoaded]);

  // スコープ変更時、その祖先フォルダ（自身は含まない）を自動展開し、スコープ中フォルダを可視にする（AC-1）。
  useEffect(() => {
    if (scopeFolderId === null || folders.length === 0) {
      return;
    }
    const ancestors = collectAncestorIds(folders, scopeFolderId);
    if (ancestors.length === 0) {
      return;
    }
    setExpandedIds(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ancestors) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    void localStateStore.expandFolders(ancestors);
  }, [scopeFolderId, folders]);

  // スコープが外部（Escape の段階戻り clear-scope・将来の状態復元 U19 等）から変更されたら、
  // 「さらに N 件…」行への一時フォーカス（focusedMoreParentId）を持ち越さない。持ち越すと focusedKey が
  // スコープと食い違ったまま固定化し、左ペインの ↑↓ 基準がズレる/無反応になる（AC-1/AC-2）。
  // moveFocus が more 行へ移る際は scopeFolderId を変更しないため、この effect が誤って打ち消すことはない。
  useEffect(() => {
    setFocusedMoreParentId(null);
  }, [scopeFolderId]);

  const toggle = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    void localStateStore.toggleExpanded(id);
  }, []);

  const rows = useMemo(
    () => flattenVisibleTree(folders, { expandedIds, revealedIds }),
    [folders, expandedIds, revealedIds],
  );

  // フォーカス行キー: 「さらに N 件…」にいるときだけスコープと分岐する（design 4.2）。
  const focusedKey = focusedMoreParentId ? `more:${focusedMoreParentId}` : scopeFolderId ? `f:${scopeFolderId}` : 'all';

  // ── キーボードインテントの実行体（actionsRef 経由で Popup から呼ばれる） ──
  const moveFocus = useCallback(
    (delta: -1 | 1) => {
      const next = moveRow(rows, focusedKey, delta);
      if (!next) {
        return;
      }
      if (next.kind === 'more') {
        setFocusedMoreParentId(next.parentId); // スコープは動かさない
        return;
      }
      setFocusedMoreParentId(null);
      onScopeChange(next.kind === 'all' ? null : next.folder.id);
    },
    [rows, focusedKey, onScopeChange],
  );

  const focusParent = useCallback(() => {
    // 「さらに N 件…」行からはその親フォルダへ戻す。
    if (focusedMoreParentId) {
      setFocusedMoreParentId(null);
      onScopeChange(focusedMoreParentId);
      return;
    }
    if (scopeFolderId === null) {
      return; // 「すべて」では何もしない
    }
    const parent = findParentId(folders, scopeFolderId);
    if (parent !== null) {
      onScopeChange(parent); // 最上位フォルダ（parent=null）では何もしない
    }
  }, [focusedMoreParentId, scopeFolderId, folders, onScopeChange]);

  const toggleExpandFocused = useCallback(() => {
    // 「さらに N 件…」行では残りを表示する。
    if (focusedMoreParentId) {
      setRevealedIds(prev => new Set(prev).add(focusedMoreParentId));
      return;
    }
    if (scopeFolderId === null) {
      return; // 「すべて」行は展開対象なし
    }
    const node = findNode(folders, scopeFolderId);
    if (node && node.children.length > 0) {
      toggle(scopeFolderId);
    }
  }, [focusedMoreParentId, scopeFolderId, folders, toggle]);

  const focusAll = useCallback(() => {
    setFocusedMoreParentId(null);
    onScopeChange(null);
  }, [onScopeChange]);

  // D&D スプリングロード: 閉じたフォルダを展開する（既に展開済み・子なしなら何もしない）。
  // キーボードの `toggle` と同じく展開状態と永続化を更新し、内部モデルの一貫性を保つ（U11 の設計思想）。
  const expand = useCallback(
    (id: string) => {
      const node = findNode(folders, id);
      if (!node || node.children.length === 0 || expandedIds.has(id)) {
        return;
      }
      toggle(id);
    },
    [folders, expandedIds, toggle],
  );

  // 命令ハンドルを毎レンダー最新の closure で公開する（useImperativeHandle 相当）。
  useEffect(() => {
    actionsRef.current = { moveFocus, focusParent, toggleExpand: toggleExpandFocused, focusAll, expand };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, moveFocus, focusParent, toggleExpandFocused, focusAll, expand]);

  // 左ペインがフォーカスされたら実 DOM フォーカスをツリールートへ当てる（起動直後を含む）。
  useEffect(() => {
    if (focused) {
      rootRef.current?.focus();
    }
  }, [focused]);

  // フォーカス行が可視範囲外なら追従する。
  useEffect(() => {
    rowRefs.current.get(focusedKey)?.scrollIntoView({ block: 'nearest' });
  }, [focusedKey, rows]);

  // クリック共通処理: スコープ/展開/残り表示を更新し、DOM フォーカスをツリールートへ戻す（AC-8）。
  const handleSelectScope = (id: string | null) => {
    onActivate();
    setFocusedMoreParentId(null);
    onScopeChange(id);
    rootRef.current?.focus();
  };
  const handleToggle = (id: string) => {
    onActivate();
    toggle(id);
    rootRef.current?.focus();
  };
  const handleReveal = (parentId: string) => {
    onActivate();
    setRevealedIds(prev => new Set(prev).add(parentId));
    setFocusedMoreParentId(parentId);
    rootRef.current?.focus();
  };

  // 行キーごとに ref コールバックをキャッシュして identity を安定させる（毎レンダーの不要な着脱を避ける）。
  const registerRef = useCallback((key: string) => {
    const cache = refCallbackCache.current;
    let cb = cache.get(key);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (el) {
          rowRefs.current.set(key, el);
        } else {
          rowRefs.current.delete(key);
        }
      };
      cache.set(key, cb);
    }
    return cb;
  }, []);

  const scopeOf = (row: TreeRow): boolean =>
    row.kind === 'all' ? scopeFolderId === null : row.kind === 'folder' ? row.folder.id === scopeFolderId : false;

  return (
    // 縦横スクロール。深い階層/長い名前はスライド（横スクロール）で全表示する。
    // tabIndex=-1 で実 DOM フォーカスを受け、キー処理は Popup の document リスナーが担う。
    <div ref={rootRef} role="tree" aria-label="フォルダ" tabIndex={-1} className="h-full overflow-auto outline-none">
      <div className="flex w-max min-w-full flex-col gap-[1px] px-2 py-3">
        {/* 復元適用前（!ready）は行を描画しない。既定スコープ「すべて」でのフラッシュを避ける（U19）。 */}
        {(ready ? rows : []).map(row => {
          const key = rowKey(row);
          const folderId = row.kind === 'folder' ? row.folder.id : null;
          return (
            <FolderTreeItem
              key={key}
              row={row}
              scoped={scopeOf(row)}
              paneFocused={focused}
              focused={key === focusedKey}
              expanded={folderId !== null && expandedIds.has(folderId)}
              dropTarget={folderId !== null && folderId === dropTargetId}
              onToggleExpand={() => folderId && handleToggle(folderId)}
              onSelectScope={() => handleSelectScope(row.kind === 'folder' ? folderId : null)}
              onRevealMore={() => row.kind === 'more' && handleReveal(row.parentId)}
              registerRef={registerRef(key)}
            />
          );
        })}
      </div>
    </div>
  );
};

export type { FolderTreeActions };
