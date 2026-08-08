import { deleteRowsCore, moveRowsCore, undoDeleteRowsCore, undoMoveRowsCore } from './bulkActionsCore.js';
import { aliasStore, bookmarkService, searchEngine } from '@src/services';
import { useCallback, useMemo, useState } from 'react';
import type { BulkDeleteTarget, BulkMoveTarget, DeleteDeps, MoveDeps } from './bulkActionsCore.js';
import type { SearchResultItem } from '@extension/shared';
import type { CommitPlan } from '@src/components/inlineEditModel';

export interface UseRowActionsApi {
  /**
   * インライン編集の確定内容を反映する（`planCommit` の `update`/`unchanged` のみを渡す）。
   * 戻り値は成功したか（no-op も成功扱い）。失敗時は `false` を返し、呼び出し側は楽観的な状態更新を
   * 行わないようにする（U14 で `useAddCurrent` が実データとの乖離を防ぐために利用する）。
   */
  commitEdit: (item: SearchResultItem, plan: CommitPlan) => Promise<boolean>;
  /** 行を削除し、5秒の即時アンドゥを登録する（UC-5 の第1層）。戻り値は成功したか。 */
  deleteRow: (item: SearchResultItem) => Promise<boolean>;
  /** 行を別フォルダへ移動し、5秒の即時アンドゥを登録する（UC-3・U12）。同一親への移動は no-op（成功扱い）。戻り値は成功したか。 */
  moveRow: (item: SearchResultItem, targetFolderId: string, targetFolderPath: string[]) => Promise<boolean>;
  /**
   * 複数行を一括で別フォルダへ移動し、**1つの**5秒即時アンドゥで全戻しできるようにする（U13）。
   * 既に対象フォルダにある行は対象から除外する（`moveRow` の同一親 no-op と同じ扱い）。
   */
  moveRows: (items: SearchResultItem[], targetFolderId: string, targetFolderPath: string[]) => Promise<void>;
  /**
   * 複数行を一括で削除し、**1つの**5秒即時アンドゥで全戻しできるようにする（U13）。
   * URL の無い行（フォルダ等）は対象から除外する。
   */
  deleteRows: (items: SearchResultItem[]) => Promise<void>;
  /** 直近の操作失敗（danger トースト用）。 */
  error: string | null;
  /** エラートーストを閉じる。 */
  clearError: () => void;
}

/**
 * リネーム/URL編集/削除のオーケストレーション（U10）。
 *
 * `BookmarkService`/`AliasStore`（データ層）呼び出し → `SearchEngine` の索引更新 → 再検索、を
 * 一箇所に集約し `Popup.tsx` の肥大化を防ぐ。破壊的操作の失敗時は索引を触らずエラー通知のみ行う
 * （UI と実データの乖離を作らない。development-guidelines「エラーハンドリング」）。
 *
 * `register`（`useUndo` の返す関数）は呼び出し側から注入する。`useUndo` を本フック内で
 * 独立に呼ぶと、`Popup` 側の `useUndo`（トースト表示用）と別々に `UndoManager` を購読する
 * 2つの state ができてしまうため、単一の購読を共有する設計にしている。
 */
export const useRowActions = (
  refresh: () => void,
  register: (label: string, undo: () => Promise<void>) => void,
): UseRowActionsApi => {
  const [error, setError] = useState<string | null>(null);

  const commitEdit = useCallback(
    async (item: SearchResultItem, plan: CommitPlan) => {
      if (plan.type !== 'update') {
        return true;
      }
      const { id, url: originalUrl } = item.node;
      try {
        // タイトル/URL はそれぞれ成功した時点で索引へ反映する。1つの try にまとめて
        // 索引更新を最後に1回だけ行うと、片方が失敗した際に「実データは変更済みだが
        // 索引は旧値のまま」という表示と実データの乖離が生まれるため。
        if (plan.title !== undefined) {
          await bookmarkService.rename(id, plan.title);
          searchEngine.updateNode(id, { title: plan.title });
        }
        if (plan.url !== undefined) {
          await bookmarkService.updateUrl(id, plan.url);
          searchEngine.updateNode(id, { url: plan.url });
          // 別名は URL 正規化ハッシュで紐付くため、URL 変更後は旧 URL の別名レコードが
          // AliasStore に孤児として残る。次に同じ URL が別のブックマークとして登録された際に
          // 意図せず別名が"復活"するのを防ぐため、旧レコードを削除する。
          if (originalUrl && item.aliases.length > 0) {
            await aliasStore
              .remove(originalUrl)
              .catch(e => console.error('[useRowActions] URL変更に伴う旧別名の除去に失敗しました:', e));
          }
        }
        refresh();
        return true;
      } catch (e) {
        console.error('[useRowActions] 編集の保存に失敗しました:', e);
        setError('編集内容を保存できませんでした');
        return false;
      }
    },
    [refresh],
  );

  const deleteRow = useCallback(
    async (item: SearchResultItem) => {
      const { id, title, url } = item.node;
      if (!url) {
        return true;
      }
      // 復元に必要な情報を削除前に索引から退避する（UC-5「元パス取得・別名退避」）。
      // ※U16（ゴミ箱）はこの直後に TrashStore.push(...) を差し込むだけで2層防御になる。
      const folderPath = item.folderPath;
      const aliases = item.aliases;

      try {
        await bookmarkService.remove(id);
      } catch (e) {
        console.error('[useRowActions] 削除に失敗しました:', e);
        setError('削除できませんでした');
        return false;
      }

      try {
        await aliasStore.remove(url);
      } catch (e) {
        // ブックマークは既に削除済みのため索引更新・アンドゥ登録は続行する。
        // 別名の残留はアンドゥ実行時の upsert で上書きされ整合する。
        console.error('[useRowActions] 削除に伴う別名の除去に失敗しました:', e);
      }

      searchEngine.removeNode(id);
      refresh();

      register(`「${title}」を削除しました`, async () => {
        try {
          const parentId = await bookmarkService.ensureFolderPath(folderPath);
          const created = await bookmarkService.create({ url, title, parentId });
          if (aliases.length > 0) {
            await aliasStore.upsert(url, aliases);
          }
          searchEngine.addNode(created, folderPath, aliases);
          refresh();
        } catch (e) {
          console.error('[useRowActions] 削除のアンドゥに失敗しました:', e);
          setError('元に戻せませんでした');
        }
      });
      return true;
    },
    [refresh, register],
  );

  const moveRow = useCallback(
    async (item: SearchResultItem, targetFolderId: string, targetFolderPath: string[]) => {
      const { id, title } = item.node;
      const originalParentId = item.node.parentId;
      const originalFolderPath = item.folderPath;
      // 同じ親への移動は無意味なため何もしない（アンドゥも登録しない・成功扱い）。
      if (originalParentId === targetFolderId) {
        return true;
      }

      try {
        // データ層で即時移動 → 索引を部分更新 → 再検索（UC-3。結果から消さずパス表示だけ更新する）。
        await bookmarkService.move(id, targetFolderId);
      } catch (e) {
        console.error('[useRowActions] 移動に失敗しました:', e);
        setError('移動できませんでした');
        return false;
      }

      searchEngine.moveNode(id, targetFolderId, targetFolderPath);
      refresh();

      register(`「${title}」を移動しました`, async () => {
        try {
          // 元の親が不明（ルート直下等で parentId 無し）なら戻せない。他の失敗パスと同様に通知する。
          if (originalParentId === undefined) {
            setError('元に戻せませんでした');
            return;
          }
          await bookmarkService.move(id, originalParentId);
          searchEngine.moveNode(id, originalParentId, originalFolderPath);
          refresh();
        } catch (e) {
          console.error('[useRowActions] 移動のアンドゥに失敗しました:', e);
          setError('元に戻せませんでした');
        }
      });
      return true;
    },
    [refresh, register],
  );

  // 一括移動/削除の中核（対象フィルタ・1件ごとの部分失敗耐性）は `bulkActionsCore`（純粋・DI）に委譲する。
  // 依存（chrome API ラッパ）をここで束ねる。services.ts のモジュールスコープ単一インスタンス（不変）を
  // 注入するだけの薄いアダプタのため、`useMemo([])` で1度だけ生成し `moveRows`/`deleteRows` の
  // `useCallback` を無用に再生成しない（`react-hooks/exhaustive-deps` の指摘どおり安定化する）。
  const moveDeps = useMemo<MoveDeps>(
    () => ({
      move: (id, parentId) => bookmarkService.move(id, parentId),
      moveNode: (id, parentId, folderPath) => searchEngine.moveNode(id, parentId, folderPath),
    }),
    [],
  );
  const deleteDeps = useMemo<DeleteDeps>(
    () => ({
      remove: id => bookmarkService.remove(id),
      removeAlias: url => aliasStore.remove(url),
      removeNode: id => searchEngine.removeNode(id),
      ensureFolderPath: path => bookmarkService.ensureFolderPath(path),
      create: data => bookmarkService.create(data),
      upsertAlias: (url, aliases) => aliasStore.upsert(url, aliases),
      addNode: (node, folderPath, aliases) => searchEngine.addNode(node, folderPath, aliases),
    }),
    [],
  );

  const moveRows = useCallback(
    async (items: SearchResultItem[], targetFolderId: string, targetFolderPath: string[]) => {
      const targets: BulkMoveTarget[] = items.map(item => ({
        id: item.node.id,
        parentId: item.node.parentId,
        folderPath: item.folderPath,
      }));

      const { moved, anyFailed } = await moveRowsCore(targets, targetFolderId, targetFolderPath, moveDeps);

      if (moved.length > 0) {
        refresh();
      }
      if (anyFailed) {
        setError('一部の項目を移動できませんでした');
      }
      if (moved.length === 0) {
        return;
      }

      // 1つの undo で成功した全件を元の親へ戻す（AC-4「一括アンドゥが1回で全戻し」）。
      // `undoMoveRowsCore` は1件ごとに独立して処理するため、途中の失敗が残りの件の巻き戻しを止めない。
      register(`${moved.length}件を移動しました`, async () => {
        const { anyFailed: undoFailed } = await undoMoveRowsCore(moved, moveDeps);
        refresh();
        if (undoFailed) {
          setError('一部を元に戻せませんでした');
        }
      });
    },
    [refresh, register, moveDeps],
  );

  const deleteRows = useCallback(
    async (items: SearchResultItem[]) => {
      // URL の無い行（フォルダ等。現状の結果には現れないが念のため防御）は対象から除外する。
      const targets: BulkDeleteTarget[] = items
        .filter((item): item is SearchResultItem & { node: { url: string } } => Boolean(item.node.url))
        .map(item => ({
          id: item.node.id,
          title: item.node.title,
          url: item.node.url,
          folderPath: item.folderPath,
          aliases: item.aliases,
        }));

      const { removed, anyFailed } = await deleteRowsCore(targets, deleteDeps);

      if (removed.length > 0) {
        refresh();
      }
      if (anyFailed) {
        setError('一部の項目を削除できませんでした');
      }
      if (removed.length === 0) {
        return;
      }

      // 1つの undo で成功した全件を再作成する（AC-4）。`undoDeleteRowsCore` は1件ごとに独立して処理するため、
      // 途中の失敗が残りの件の再作成を止めない。
      register(`${removed.length}件を削除しました`, async () => {
        const { anyFailed: undoFailed } = await undoDeleteRowsCore(removed, deleteDeps);
        refresh();
        if (undoFailed) {
          setError('一部を元に戻せませんでした');
        }
      });
    },
    [refresh, register, deleteDeps],
  );

  const clearError = useCallback(() => setError(null), []);

  return { commitEdit, deleteRow, moveRow, moveRows, deleteRows, error, clearError };
};
