import { SPRING_LOAD_MS, autoScrollDirection, exceedsThreshold, isValidDropTarget } from '../components/dragModel.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Point } from '../components/dragModel.js';
import type { SearchResultItem } from '@extension/shared';
import type { MouseEvent as ReactMouseEvent } from 'react';

/** オートスクロールの1フレームあたりのスクロール量（px）。 */
const AUTOSCROLL_STEP_PX = 8;
/** 左ペイン（フォルダツリー）のスクロールコンテナのセレクタ。 */
const TREE_SELECTOR = '[role="tree"]';

interface DragSession {
  item: SearchResultItem;
  start: Point;
  active: boolean;
  /** スプリングロード（自動展開）待ちのフォルダ ID とタイマー。 */
  springFolderId: string | null;
  springTimer: ReturnType<typeof setTimeout> | null;
}

interface UseDragAndDropParams {
  /** ドラッグ開始時に DRAG モードへ入る。 */
  enterDrag: (id: string) => void;
  /** ドラッグ開始直前に LIST へ揃える（FOLDER_TREE から開始しても DRAG に遷移できるようにする）。 */
  exitToList: () => void;
  /** 有効なフォルダへドロップしたときの移動実行（folderId は現在の親でないことが保証される）。 */
  onDrop: (item: SearchResultItem, folderId: string) => void;
  /** スプリングロード（閉じたフォルダの自動展開）。`FolderTreeActions.expand` を渡す。 */
  springLoad: (folderId: string) => void;
}

interface UseDragAndDropApi {
  /** ドラッグ中のブックマーク（null = 非ドラッグ）。ゴースト描画の判定に使う。 */
  dragging: SearchResultItem | null;
  /** ゴーストの表示座標（ビューポート基準）。 */
  ghostPos: Point;
  /** 現在のドロップ先候補フォルダ ID（破線ハイライト用）。 */
  dropTargetId: string | null;
  /** 結果行の `mousedown` ハンドラ（5px 超で D&D 開始）。 */
  onRowMouseDown: (item: SearchResultItem, e: ReactMouseEvent) => void;
}

/** スプリングロード待ちのタイマーをクリアする。 */
const clearSpring = (session: DragSession): void => {
  if (session.springTimer !== null) {
    clearTimeout(session.springTimer);
    session.springTimer = null;
  }
  session.springFolderId = null;
};

/**
 * 結果行のドラッグ&ドロップによるフォルダ移動（U12・DRAG モード）。
 *
 * 座標・しきい値・ドロップ有効判定は純粋モデル（`dragModel`）へ委譲し、本フックは DOM 結線
 * （`document` の mousemove/mouseup/keydown・`elementFromPoint` によるドロップ先判定・オートスクロールの
 * rAF ループ）に徹する薄い層にする。ドロップ先の判定は左ペイン行の `data-folder-id`（`FolderTreeItem`）を
 * `elementFromPoint` で拾う。現在の親フォルダは無効（`isValidDropTarget`）。閉じたフォルダに 600ms 留まると
 * スプリングロードで自動展開し、ペイン上下端 40px でオートスクロールする。`Escape`／ペイン外ドロップで中止する。
 */
export const useDragAndDrop = ({
  enterDrag,
  exitToList,
  onDrop,
  springLoad,
}: UseDragAndDropParams): UseDragAndDropApi => {
  const [dragging, setDragging] = useState<SearchResultItem | null>(null);
  const [ghostPos, setGhostPos] = useState<Point>({ x: 0, y: 0 });
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // 進行中のドラッグセッション（クロージャの stale を避けるため ref で保持）。
  const sessionRef = useRef<DragSession | null>(null);
  // dropTargetId を同期的にも参照する（endSession が最新値を読むため）。
  const dropTargetIdRef = useRef<string | null>(null);
  // オートスクロールの方向（rAF ループが毎フレーム参照）。
  const scrollDirRef = useRef<-1 | 0 | 1>(0);
  const rafRef = useRef<number | null>(null);
  // document リスナーの identity を固定するための ref（張り替えなしで最新ハンドラを呼ぶ）。
  const onMoveRef = useRef<((e: globalThis.MouseEvent) => void) | null>(null);
  const onUpRef = useRef<(() => void) | null>(null);
  const onKeyRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  // 最新のコールバックを ref 経由で参照する。
  const cbRef = useRef({ enterDrag, exitToList, onDrop, springLoad });
  cbRef.current = { enterDrag, exitToList, onDrop, springLoad };

  const stopAutoScroll = useCallback(() => {
    scrollDirRef.current = 0;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const runAutoScroll = useCallback(() => {
    const tick = () => {
      const dir = scrollDirRef.current;
      if (dir === 0) {
        rafRef.current = null;
        return;
      }
      document.querySelector(TREE_SELECTOR)?.scrollBy(0, dir * AUTOSCROLL_STEP_PX);
      rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, []);

  // セッション終了の共通後始末（ドロップ・中止・アンマウント共通）。
  const endSession = useCallback(
    (drop: boolean) => {
      const session = sessionRef.current;
      sessionRef.current = null;
      stopAutoScroll();
      if (onMoveRef.current) {
        document.removeEventListener('mousemove', onMoveRef.current);
      }
      if (onUpRef.current) {
        document.removeEventListener('mouseup', onUpRef.current);
      }
      if (onKeyRef.current) {
        document.removeEventListener('keydown', onKeyRef.current);
      }
      if (session) {
        clearSpring(session);
        if (session.active) {
          if (drop && dropTargetIdRef.current !== null) {
            cbRef.current.onDrop(session.item, dropTargetIdRef.current);
          }
          cbRef.current.exitToList();
        }
      }
      setDragging(null);
      setDropTargetId(null);
      dropTargetIdRef.current = null;
    },
    [stopAutoScroll],
  );

  const handleMove = useCallback(
    (e: globalThis.MouseEvent) => {
      const session = sessionRef.current;
      if (!session) {
        return;
      }
      const current: Point = { x: e.clientX, y: e.clientY };

      // 未開始: しきい値（5px）を超えたら DRAG を開始する。
      if (!session.active) {
        if (!exceedsThreshold(session.start, current)) {
          return;
        }
        session.active = true;
        cbRef.current.exitToList();
        cbRef.current.enterDrag(session.item.node.id);
        setDragging(session.item);
      }

      e.preventDefault(); // ドラッグ中のテキスト選択を抑止する。
      setGhostPos(current);

      // ドロップ先判定: カーソル直下の要素から data-folder-id を拾う。
      const el = document.elementFromPoint(current.x, current.y);
      const folderEl = el?.closest('[data-folder-id]') ?? null;
      const folderId = folderEl?.getAttribute('data-folder-id') ?? null;
      const currentParentId = session.item.node.parentId ?? null;
      const valid = isValidDropTarget(folderId, currentParentId) ? folderId : null;
      if (valid !== dropTargetIdRef.current) {
        dropTargetIdRef.current = valid;
        setDropTargetId(valid);
      }

      // スプリングロード: 有効な閉じたフォルダ上に 600ms 留まったら自動展開する。
      if (valid !== session.springFolderId) {
        clearSpring(session);
        if (valid !== null) {
          session.springFolderId = valid;
          session.springTimer = setTimeout(() => {
            cbRef.current.springLoad(valid);
          }, SPRING_LOAD_MS);
        }
      }

      // オートスクロール: 左ペイン上下端 40px で方向を決め、rAF ループを回す。
      const tree = document.querySelector(TREE_SELECTOR);
      if (tree) {
        const rect = tree.getBoundingClientRect();
        const dir = autoScrollDirection({ top: rect.top, bottom: rect.bottom }, current.y);
        scrollDirRef.current = dir;
        if (dir !== 0) {
          runAutoScroll();
        }
      }
    },
    [runAutoScroll],
  );

  const handleUp = useCallback(() => endSession(true), [endSession]);
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      // ドラッグ中の Escape は移動せず中止する（drag:cancel）。
      if (e.key === 'Escape' && sessionRef.current?.active) {
        e.preventDefault();
        endSession(false);
      }
    },
    [endSession],
  );

  // ハンドラ ref を最新に保つ（endSession の removeEventListener が正しい参照を外せるように）。
  onMoveRef.current = handleMove;
  onUpRef.current = handleUp;
  onKeyRef.current = handleKey;

  const onRowMouseDown = useCallback((item: SearchResultItem, e: ReactMouseEvent) => {
    // 主ボタンのみ。既存セッションがあれば無視する。
    if (e.button !== 0 || sessionRef.current) {
      return;
    }
    sessionRef.current = {
      item,
      start: { x: e.clientX, y: e.clientY },
      active: false,
      springFolderId: null,
      springTimer: null,
    };
    if (onMoveRef.current) {
      document.addEventListener('mousemove', onMoveRef.current);
    }
    if (onUpRef.current) {
      document.addEventListener('mouseup', onUpRef.current);
    }
    if (onKeyRef.current) {
      document.addEventListener('keydown', onKeyRef.current);
    }
  }, []);

  // アンマウント時の後始末（リスナー・タイマー・rAF の取りこぼし防止）。
  useEffect(
    () => () => {
      if (sessionRef.current) {
        endSession(false);
      }
    },
    [endSession],
  );

  return { dragging, ghostPos, dropTargetId, onRowMouseDown };
};

export type { UseDragAndDropApi };
