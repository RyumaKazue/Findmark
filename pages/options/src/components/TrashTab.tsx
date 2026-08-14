import { useI18n } from '@extension/i18n';
import { settingsStore, trashStore } from '@src/services';
import { useCallback, useEffect, useState } from 'react';
import type { MessageKey } from '@extension/i18n';
import type { TrashItem } from '@extension/storage';

/** 削除日時（epoch ms）を「YYYY/MM/DD HH:mm」表記に整形する（外部ライブラリ非依存）。 */
const formatDeletedAt = (epochMs: number): string => {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** `TrashItem` の配下件数（folder のとき再帰的に数える。bookmark は 1）。 */
const countLeaves = (item: TrashItem): number =>
  item.kind === 'bookmark' ? 1 : (item.children ?? []).reduce((sum, child) => sum + countLeaves(child), 0);

/**
 * ゴミ箱タブ（U16・PRD 機能12「ゴミ箱(削除データの保持・復元)」）。
 *
 * マウント時に `settingsStore.get()` で保持日数を取得 → `trashStore.purgeExpired` で保持期間切れを
 * 自動削除 → `trashStore.list()` で一覧を取得する。ポップアップ側は即時アンドゥ（第1層）のみを持ち、
 * ここが第2層（30日保持）の唯一の復元導線になる（PRD 機能12「ゴミ箱UIはオプションページの
 * 「ゴミ箱」タブに置く」）。
 */
export const TrashTab = () => {
  const { t } = useI18n();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 文言ではなくメッセージキーで保持し、表示中に表示言語を切り替えても再翻訳されるようにする（U18）。
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorKey(null);
    try {
      const settings = await settingsStore.get();
      await trashStore.purgeExpired(settings.trashRetentionDays);
      const list = await trashStore.list();
      setItems(list);
    } catch (e) {
      console.error('[TrashTab] ゴミ箱の読み込みに失敗しました:', e);
      setErrorKey('optionsTrashErrorLoad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRestore = async (id: string): Promise<void> => {
    setBusyId(id);
    setErrorKey(null);
    try {
      await trashStore.restore(id);
      setItems(current => current.filter(item => item.id !== id));
    } catch (e) {
      console.error('[TrashTab] 復元に失敗しました:', e);
      setErrorKey('optionsTrashErrorRestore');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (id: string): Promise<void> => {
    setBusyId(id);
    setErrorKey(null);
    try {
      await trashStore.remove(id);
      setItems(current => current.filter(item => item.id !== id));
    } catch (e) {
      console.error('[TrashTab] 完全削除に失敗しました:', e);
      setErrorKey('optionsTrashErrorDelete');
    } finally {
      setBusyId(null);
    }
  };

  const handleClear = async (): Promise<void> => {
    setErrorKey(null);
    try {
      await trashStore.clear();
      setItems([]);
    } catch (e) {
      console.error('[TrashTab] ゴミ箱を空にする操作に失敗しました:', e);
      setErrorKey('optionsTrashErrorClear');
    }
  };

  return (
    <div className="mx-auto max-w-[640px] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-ink text-[18px] font-bold">{t('optionsTrashHeading')}</h1>
        <button
          type="button"
          disabled={items.length === 0}
          onClick={() => void handleClear()}
          className="border-line hover:bg-pane-3 text-ink-soft flex h-8 items-center rounded-md border px-3 text-[12px] font-medium disabled:opacity-40">
          {t('optionsTrashEmptyAll')}
        </button>
      </div>

      <p className="text-ink-soft mb-4 text-[11.5px]">{t('optionsTrashDescription')}</p>

      {errorKey && <p className="text-danger mb-3 text-[12.5px]">{t(errorKey)}</p>}

      {loading ? (
        <p className="text-ink-faint text-[12.5px]">{t('commonLoading')}</p>
      ) : items.length === 0 ? (
        <div className="border-line rounded-lg border border-dashed p-8 text-center">
          <p className="text-ink-faint text-[12.5px]">{t('optionsTrashEmpty')}</p>
        </div>
      ) : (
        <ul className="border-line divide-line-row divide-y rounded-lg border">
          {items.map(item => (
            <li key={item.id} className="flex items-center gap-3 p-3">
              <span aria-hidden="true" className="text-[16px]">
                {item.kind === 'folder' ? '📁' : '🔖'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-ink truncate text-[13px] font-medium" title={item.title}>
                  {item.title}
                  {item.kind === 'folder' && (
                    <span className="text-ink-faint ml-1.5 text-[11px] font-normal">
                      {t('optionsTrashItemCount', String(countLeaves(item)))}
                    </span>
                  )}
                </p>
                {item.url && (
                  <p className="text-ink-soft truncate text-[11.5px]" title={item.url}>
                    {item.url}
                  </p>
                )}
                <p className="text-ink-faint mt-0.5 text-[11px]">
                  {t('optionsTrashDeletedAt', [
                    item.folderPath.join(' / ') || t('commonRootFolder'),
                    formatDeletedAt(item.deletedAt),
                  ])}
                </p>
                {item.aliases.length > 0 && (
                  <p className="text-ink-faint mt-0.5 truncate text-[11px]">
                    {t('optionsTrashAliases', item.aliases.join(', '))}
                  </p>
                )}
              </div>
              <div className="flex flex-none items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void handleRestore(item.id)}
                  className="bg-accent flex h-8 items-center rounded-md px-3 text-[12px] font-bold text-white disabled:opacity-50">
                  {t('commonRestore')}
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void handleRemove(item.id)}
                  className="border-line hover:bg-pane-3 text-ink-soft flex h-8 items-center rounded-md border px-3 text-[12px] font-medium disabled:opacity-50">
                  {t('commonDelete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
