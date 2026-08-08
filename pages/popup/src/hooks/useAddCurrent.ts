import { findFolderPath } from '../components/folderTreeModel.js';
import { validateUrl } from '../components/inlineEditModel.js';
import { aliasStore, bookmarkService, localStateStore, searchEngine } from '@src/services';
import { useCallback, useState } from 'react';
import type { SearchResultItem } from '@extension/shared';
import type { FolderTreeNode } from '@src/components/folderTreeModel';
import type { UseRowActionsApi } from '@src/hooks/useRowActions';

/** 現在ページ登録パネル（`AddCurrentPanel`）が編集する対象の状態（U14）。 */
interface AddCurrentEntry {
  id: string;
  title: string;
  url: string;
  parentId: string | undefined;
  /** 上位→末端のフォルダ名（表示用。真のルートは含まない）。 */
  folderPath: string[];
  aliases: string[];
  /** `open()` 時点で既に同一 URL のブックマークが存在したか（「★ 登録済み」表示の判定に使う）。 */
  alreadyRegistered: boolean;
}

interface UseAddCurrentApi {
  /** 編集対象（未オープン時は `null`）。 */
  entry: AddCurrentEntry | null;
  /** 直近の操作失敗（danger トースト用）。 */
  error: string | null;
  clearError: () => void;
  /**
   * 現在のアクティブタブを即時登録（既存なら流用）し、`entry` を確定する。
   * 呼び出し側は戻り値が `true` のときのみパネルを開く（モード遷移は Popup の責務）。
   */
  open: () => Promise<boolean>;
  /** タイトルを変更する（フォーカスアウト確定）。 */
  updateTitle: (title: string) => Promise<void>;
  /** 保存先フォルダを変更する（`lastUsedFolderId` も更新する）。 */
  updateFolder: (folderId: string, folderPath: string[]) => Promise<void>;
  /** 別名を変更する。 */
  updateAliases: (aliases: string[]) => Promise<void>;
  /** 登録を取り消す（5秒アンドゥ付き）。完了後 `entry` は `null` になる。 */
  remove: () => Promise<void>;
  /** パネルを閉じる際に `entry` をリセットする（Popup が呼ぶ。登録自体は取り消さない）。 */
  reset: () => void;
}

/** `AddCurrentEntry` から `useRowActions` が要求する疑似 `SearchResultItem` を組み立てる。 */
const toItem = (entry: AddCurrentEntry): SearchResultItem => ({
  node: { id: entry.id, parentId: entry.parentId, title: entry.title, url: entry.url },
  folderPath: entry.folderPath,
  aliases: entry.aliases,
  matchedAliases: [],
  matchedFields: [],
  score: 0,
});

/**
 * 現在ページ登録（U14・PRD 機能9）のオーケストレーション。
 *
 * 「即座に登録し編集パネルを開く」を担う `open()` 以外は、既存の破壊的操作オーケストレーション
 * （`useRowActions` の `commitEdit`/`moveRow`/`deleteRow`）へ疑似 `SearchResultItem` 経由で委譲する。
 * これにより削除・移動の5秒アンドゥ・索引更新ロジックを重複させない
 * （development-guidelines「破壊的操作には必ずアンドゥ手段を伴わせる」を自動的に満たす）。
 *
 * `folders`（左ペインと同じフォルダツリー。新規作成時のフォルダパス解決に使う）と `refresh`
 * （`useSearch` の索引再計算トリガー）は呼び出し側（Popup）から注入する。
 */
const useAddCurrent = (
  folders: FolderTreeNode[],
  refresh: () => void,
  rowActions: UseRowActionsApi,
): UseAddCurrentApi => {
  const [entry, setEntry] = useState<AddCurrentEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async () => {
    try {
      const tab = await bookmarkService.getCurrentTab();
      // 空 URL（activeTab 権限が及ばないページ等）は「未入力」ではなく「このページは対象外」と伝える。
      if (tab.url === '') {
        setError('このページは登録できません');
        return false;
      }
      const validation = validateUrl(tab.url);
      if (!validation.ok) {
        setError(validation.message);
        return false;
      }

      const existing = await bookmarkService.findByUrl(tab.url);
      if (existing && existing.url) {
        const [folderPath, aliasRecord] = await Promise.all([
          bookmarkService.getFolderPath(existing.id),
          aliasStore.getByUrl(existing.url),
        ]);
        setEntry({
          id: existing.id,
          title: existing.title,
          url: existing.url,
          parentId: existing.parentId,
          folderPath,
          aliases: aliasRecord?.aliases ?? [],
          alreadyRegistered: true,
        });
        return true;
      }

      const local = await localStateStore.get();
      let parentId = local.lastUsedFolderId;
      let folderPath = parentId ? findFolderPath(folders, parentId) : [];
      // 前回フォルダが未使用、または削除済み（`folders` に見つからない）なら既定書き込み先へフォールバックする
      // （U19 の `resolveRestoredScope` と同じ「削除済み参照は既定値へ倒す」方針）。
      if (!parentId || folderPath.length === 0) {
        parentId = await bookmarkService.ensureFolderPath([]);
        folderPath = findFolderPath(folders, parentId);
      }
      const created = await bookmarkService.create({ url: tab.url, title: tab.title || tab.url, parentId });
      searchEngine.addNode(created, folderPath, []);
      refresh();
      setEntry({
        id: created.id,
        title: created.title,
        url: created.url ?? tab.url,
        parentId: created.parentId,
        folderPath,
        aliases: [],
        alreadyRegistered: false,
      });
      return true;
    } catch (e) {
      console.error('[useAddCurrent] 現在のページを登録できませんでした:', e);
      setError('現在のページを登録できませんでした');
      return false;
    }
  }, [folders, refresh]);

  const updateTitle = useCallback(
    async (title: string) => {
      if (!entry) {
        return;
      }
      // `commitEdit` は失敗時 false を返す（トーストは rowActions 側が出す）。失敗時は entry を
      // 更新しない＝パネルの表示が実データと乖離しないようにする（実装検証で指摘された不整合の是正）。
      const ok = await rowActions.commitEdit(toItem(entry), { type: 'update', title });
      if (ok) {
        setEntry(prev => (prev ? { ...prev, title } : prev));
      }
    },
    [entry, rowActions],
  );

  const updateFolder = useCallback(
    async (folderId: string, folderPath: string[]) => {
      if (!entry) {
        return;
      }
      const ok = await rowActions.moveRow(toItem(entry), folderId, folderPath);
      if (ok) {
        // 移動が失敗した場合は「前回フォルダ」も更新しない（実際に保存されていない場所を次回の初期値にしない）。
        await localStateStore.setLastUsedFolder(folderId);
        setEntry(prev => (prev ? { ...prev, parentId: folderId, folderPath } : prev));
      }
    },
    [entry, rowActions],
  );

  const updateAliases = useCallback(
    async (aliases: string[]) => {
      if (!entry) {
        return;
      }
      await aliasStore.upsert(entry.url, aliases);
      searchEngine.updateAliases(entry.url, aliases);
      refresh();
      setEntry(prev => (prev ? { ...prev, aliases } : prev));
    },
    [entry, refresh],
  );

  const remove = useCallback(async () => {
    if (!entry) {
      return;
    }
    // `deleteRow` は失敗時 false を返す。失敗時は entry を null にしない＝Popup 側の「entry が消えたら
    // 閉じる」effect を誤発火させず、削除に失敗したまま見た目だけ完了したような矛盾を防ぐ。
    const ok = await rowActions.deleteRow(toItem(entry));
    if (ok) {
      setEntry(null);
    }
  }, [entry, rowActions]);

  const reset = useCallback(() => setEntry(null), []);
  const clearError = useCallback(() => setError(null), []);

  return { entry, error, clearError, open, updateTitle, updateFolder, updateAliases, remove, reset };
};

export { useAddCurrent };
export type { AddCurrentEntry, UseAddCurrentApi };
