import { settingsStore } from '@src/services';
import { useEffect, useState } from 'react';
import type { UserSettings } from '@extension/storage';
import type { ChangeEvent } from 'react';

const RETENTION_OPTIONS = [7, 14, 30, 60, 90] as const;

/**
 * 設定タブ（U16）。ゴミ箱の保持日数と UI ロケール（`UserSettings`、`chrome.storage.sync`）を保存する。
 *
 * 保持日数は選択式にし、不正な値（負数・非数値等）を型レベルで排除する。変更は即時保存で、
 * 保存中/直後の状態をボタン横のフィードバックで示す（フォーム送信ボタンは持たない）。
 * `locale` は保存のみ行い、UI 文言への実適用（i18n）は U18（release-prep）で扱う。
 */
export const SettingsTab = () => {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [savedField, setSavedField] = useState<'retention' | 'locale' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void settingsStore.get().then(setSettings);
  }, []);

  const flashSaved = (field: 'retention' | 'locale'): void => {
    setSavedField(field);
    setTimeout(() => setSavedField(current => (current === field ? null : current)), 1500);
  };

  const handleRetentionChange = async (e: ChangeEvent<HTMLSelectElement>): Promise<void> => {
    const days = Number(e.target.value);
    setError(null);
    try {
      await settingsStore.setRetentionDays(days);
      setSettings(current => (current ? { ...current, trashRetentionDays: days } : current));
      flashSaved('retention');
    } catch (err) {
      console.error('[SettingsTab] 保持日数の保存に失敗しました:', err);
      setError('保持日数を保存できませんでした');
    }
  };

  const handleLocaleChange = async (e: ChangeEvent<HTMLSelectElement>): Promise<void> => {
    const locale = e.target.value as UserSettings['locale'];
    setError(null);
    try {
      await settingsStore.setLocale(locale);
      setSettings(current => (current ? { ...current, locale } : current));
      flashSaved('locale');
    } catch (err) {
      console.error('[SettingsTab] ロケールの保存に失敗しました:', err);
      setError('ロケールを保存できませんでした');
    }
  };

  if (!settings) {
    return (
      <div className="mx-auto max-w-[640px] p-6">
        <p className="text-ink-faint text-[12.5px]">読み込み中…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[640px] p-6">
      <h1 className="text-ink mb-4 text-[18px] font-bold">設定</h1>

      {error && <p className="text-danger mb-3 text-[12.5px]">{error}</p>}

      <section className="border-line mb-4 rounded-lg border p-4">
        <h2 className="text-ink mb-1 text-[13px] font-bold">ゴミ箱の保持日数</h2>
        <p className="text-ink-soft mb-3 text-[11.5px]">
          削除したブックマークをゴミ箱に保持する日数です。超えると自動的に削除されます。
        </p>
        <div className="flex items-center gap-2">
          <select
            value={settings.trashRetentionDays}
            onChange={e => void handleRetentionChange(e)}
            className="border-line-input bg-input-bg text-ink h-9 rounded-md border px-3 text-[12.5px]">
            {RETENTION_OPTIONS.map(days => (
              <option key={days} value={days}>
                {days}日
              </option>
            ))}
          </select>
          {savedField === 'retention' && <span className="text-accent-strong text-[11.5px]">保存しました</span>}
        </div>
      </section>

      <section className="border-line rounded-lg border p-4">
        <h2 className="text-ink mb-1 text-[13px] font-bold">表示言語</h2>
        <p className="text-ink-soft mb-3 text-[11.5px]">
          未対応の項目は既定言語のまま表示されます（UIへの反映は今後のアップデートで対応予定です）。
        </p>
        <div className="flex items-center gap-2">
          <select
            value={settings.locale ?? 'ja'}
            onChange={e => void handleLocaleChange(e)}
            className="border-line-input bg-input-bg text-ink h-9 rounded-md border px-3 text-[12.5px]">
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
          {savedField === 'locale' && <span className="text-accent-strong text-[11.5px]">保存しました</span>}
        </div>
      </section>
    </div>
  );
};
