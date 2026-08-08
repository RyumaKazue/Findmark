import { aliasStore, bookmarkService, searchEngine } from '@src/services';
import { useCallback, useState } from 'react';
import type { SearchResultItem } from '@extension/shared';
import type { CommitPlan } from '@src/components/inlineEditModel';

export interface UseRowActionsApi {
  /** インライン編集の確定内容を反映する（`planCommit` の `update`/`unchanged` のみを渡す）。 */
  commitEdit: (item: SearchResultItem, plan: CommitPlan) => Promise<void>;
  /** 行を削除し、5秒の即時アンドゥを登録する（UC-5 の第1層）。 */
  deleteRow: (item: SearchResultItem) => Promise<void>;
  /** 行を別フォルダへ移動し、5秒の即時アンドゥを登録する（UC-3・U12）。同一親への移動は no-op。 */
  moveRow: (item: SearchResultItem, targetFolderId: string, targetFolderPath: string[]) => Promise<void>;
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
        return;
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
      } catch (e) {
        console.error('[useRowActions] 編集の保存に失敗しました:', e);
        setError('編集内容を保存できませんでした');
      }
    },
    [refresh],
  );

  const deleteRow = useCallback(
    async (item: SearchResultItem) => {
      const { id, title, url } = item.node;
      if (!url) {
        return;
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
        return;
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
    },
    [refresh, register],
  );

  const moveRow = useCallback(
    async (item: SearchResultItem, targetFolderId: string, targetFolderPath: string[]) => {
      const { id, title } = item.node;
      const originalParentId = item.node.parentId;
      const originalFolderPath = item.folderPath;
      // 同じ親への移動は無意味なため何もしない（アンドゥも登録しない）。
      if (originalParentId === targetFolderId) {
        return;
      }

      try {
        // データ層で即時移動 → 索引を部分更新 → 再検索（UC-3。結果から消さずパス表示だけ更新する）。
        await bookmarkService.move(id, targetFolderId);
      } catch (e) {
        console.error('[useRowActions] 移動に失敗しました:', e);
        setError('移動できませんでした');
        return;
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
    },
    [refresh, register],
  );

  const clearError = useCallback(() => setError(null), []);

  return { commitEdit, deleteRow, moveRow, error, clearError };
};
