import { collectBookmarkIds, collectBookmarkUrls, toTrashInput } from '../components/folderDeleteModel.js';
import { useI18n } from '@extension/i18n';
import { normalizer } from '@extension/shared';
import { aliasStore, bookmarkService, searchEngine, trashStore } from '@src/services';
import { useCallback, useState } from 'react';

export interface UseFolderActionsApi {
  /**
   * フォルダを**配下ごと**削除し、5秒の即時アンドゥを登録する（`folder-delete`）。
   * `folderPath` は削除するフォルダ自身の**親までのパス**（＝復元先）。戻り値は成功したか。
   */
  deleteFolder: (args: { id: string; title: string; folderPath: string[] }) => Promise<boolean>;
  /** 直近の操作失敗（danger トースト用）。 */
  error: string | null;
  /** エラートーストを閉じる。 */
  clearError: () => void;
}

/**
 * フォルダ操作のオーケストレーション（`folder-delete`）。
 *
 * `useRowActions`（行の編集/削除/移動）と同じ骨格にする: データ層呼び出し → 検索索引の更新 → 再検索 →
 * アンドゥ登録、を1箇所に集約し、破壊的操作の失敗時は索引を触らずエラー通知のみ行う
 * （UI と実データの乖離を作らない。development-guidelines「エラーハンドリング」）。
 *
 * **順序が本質**: ゴミ箱への退避データは「削除前」にしか作れない（削除後は部分木を読めない）。
 * そのため `getSubTree` → 退避データ組み立て → `removeTree` の順を崩さない。
 *
 * `refresh`/`register` は `useRowActions` と同じく呼び出し側から注入する（`useUndo` の購読を
 * Popup と共有するため）。`reloadIndex`/`reloadFolders` は復元後の整合に使う（後述）。
 */
export const useFolderActions = (
  refresh: () => void,
  register: (label: string, undo: () => Promise<void>) => void,
  reloadIndex: () => Promise<void>,
  reloadFolders: () => void,
): UseFolderActionsApi => {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  const deleteFolder = useCallback(
    async ({ id, title, folderPath }: { id: string; title: string; folderPath: string[] }) => {
      // ── 1. 削除前に退避データを作る（削除後は部分木を読めない） ──
      let trashInput;
      let bookmarkIds: string[];
      let bookmarkUrls: string[];
      try {
        const subtree = await bookmarkService.getSubTree(id);
        // 別名は URL 正規化ハッシュで紐付く（AliasStore の契約）。1回の getAll で引き当て表を作り、
        // ブックマーク1件ごとの storage 読み出しを避ける。
        const aliasMap = await aliasStore.getAll();
        const aliasesOf = (url: string): string[] => {
          try {
            return aliasMap.get(normalizer.hashUrl(url))?.aliases ?? [];
          } catch (e) {
            // 不正な URL（`javascript:` 等）のブックマークが1件あるだけでフォルダ全体を削除不能にしない
            // （`SearchEngine.lookupAliases` と同じ規律）。別名は引けないが削除・退避は続行する。
            console.warn('[useFolderActions] 別名の紐付けに失敗しました(不正なURL):', url, e);
            return [];
          }
        };
        trashInput = toTrashInput(subtree, folderPath, aliasesOf);
        bookmarkIds = collectBookmarkIds(subtree);
        bookmarkUrls = collectBookmarkUrls(subtree);
      } catch (e) {
        console.error('[useFolderActions] 削除前のフォルダ情報の取得に失敗しました:', e);
        setError(t('popupErrorFolderDeleteFailed'));
        return false;
      }

      // ── 2. 実データを削除する。失敗したら索引・左ペインには一切触れない ──
      try {
        await bookmarkService.removeTree(id);
      } catch (e) {
        console.error('[useFolderActions] フォルダの削除に失敗しました:', e);
        setError(t('popupErrorFolderDeleteFailed'));
        return false;
      }

      // ── 3. 配下ブックマークの別名レコードを除去する ──
      // 失敗しても削除操作自体は成功扱いで続行する（別名の残留はアンドゥ/復元時の upsert で整合する）。
      // AliasStore は内部 writeQueue で直列化されるため、並列に投げても結局直列になる。逐次にして
      // どの URL で失敗したかをログに残せるようにする。
      for (const url of bookmarkUrls) {
        try {
          await aliasStore.remove(url);
        } catch (e) {
          console.error('[useFolderActions] 削除に伴う別名の除去に失敗しました:', url, e);
        }
      }

      // ── 4. 第2層防御（30日ゴミ箱）へフォルダ丸ごと1項目で退避する ──
      let trashId: string | null = null;
      try {
        trashId = await trashStore.push(trashInput);
      } catch (e) {
        console.error('[useFolderActions] ゴミ箱への退避に失敗しました:', e);
      }

      // ── 5. 検索索引と左ペインを実データへ合わせる ──
      bookmarkIds.forEach(bookmarkId => searchEngine.removeNode(bookmarkId));
      refresh();
      reloadFolders();

      // ── 6. 即時アンドゥ（第1層・5秒） ──
      register(t('popupUndoFolderDeleted', title), async () => {
        // ゴミ箱への退避に失敗している場合、復元の materials が存在しない。黙って何も起きないのが最悪なので
        // 「戻せない」ことを明示する（削除自体は成功しているため、UI 上は消えたままになる）。
        if (trashId === null) {
          setError(t('popupErrorFolderUndoUnavailable'));
          return;
        }
        try {
          // フォルダ構造・配下ブックマーク・別名まで TrashStore が再帰復元する（ID は新規採番）。
          await trashStore.restore(trashId);
          // 復元後のノードは新しい ID を持つため、addNode による部分更新では索引と実データが食い違う。
          // 索引を作り直してから左ペインを再取得する。
          await reloadIndex();
          reloadFolders();
        } catch (e) {
          console.error('[useFolderActions] フォルダ削除のアンドゥに失敗しました:', e);
          // `TrashStore.restoreInto` は子孫を1件ずつ作り直すロールバック無しの処理のため、途中で失敗すると
          // **一部だけ復元済み**という状態があり得る。索引と左ペインを実データへ追従させ、乖離を残さない
          // （ここを省くと「画面には無いが実際には存在するフォルダ」が生まれる）。
          await reloadIndex();
          reloadFolders();
          // 項目はゴミ箱に残るため、オプションページの「ゴミ箱」タブから再度復元できる。
          setError(t('popupErrorUndoFailed'));
        }
      });
      return true;
    },
    [refresh, register, reloadIndex, reloadFolders, t],
  );

  const clearError = useCallback(() => setError(null), []);

  return { deleteFolder, error, clearError };
};
