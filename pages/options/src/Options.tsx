import '@src/Options.css';
import { I18nProvider, useI18n } from '@extension/i18n';
import { withErrorBoundary } from '@extension/shared';
import { ErrorDisplay } from '@extension/ui';
import { ImportExportTab } from '@src/components/ImportExportTab';
import { SettingsTab } from '@src/components/SettingsTab';
import { TrashTab } from '@src/components/TrashTab';
import { useUiLocale } from '@src/hooks/useUiLocale';
import { useState } from 'react';
import type { MessageKey, UiLocale } from '@extension/i18n';

type TabId = 'import-export' | 'trash' | 'settings';

const TABS: { id: TabId; labelKey: MessageKey }[] = [
  { id: 'import-export', labelKey: 'optionsTabImportExport' },
  { id: 'trash', labelKey: 'optionsTabTrash' },
  { id: 'settings', labelKey: 'optionsTabSettings' },
];

interface OptionsBodyProps {
  /** 設定タブでの言語変更を即時に反映する（U18）。 */
  onLocaleChange: (locale: UiLocale) => void;
}

/**
 * オプションページの本体（U15 でインポート/エクスポートを実装、U16 でタブ機構・ゴミ箱・設定を追加）。
 * ポップアップに置けない機能（ファイルダイアログを要するインポート/エクスポート、削除データの
 * 復元、保持日数・locale の設定）をここに集約する。
 *
 * タブは3つのみで外部依存を増やす必要がないため、ルーターは導入せず `useState` の最小構成にする。
 */
const OptionsBody = ({ onLocaleChange }: OptionsBodyProps) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabId>('import-export');

  return (
    <div className="bg-pane min-h-screen">
      <div className="border-line bg-surface sticky top-0 z-10 border-b">
        <div
          role="tablist"
          aria-label={t('optionsTablistLabel')}
          className="mx-auto flex max-w-[640px] gap-1 px-6 pt-3">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={
                activeTab === tab.id
                  ? 'text-accent-strong border-accent -mb-px flex h-9 items-center border-b-2 px-3 text-[12.5px] font-bold'
                  : 'text-ink-soft hover:text-ink -mb-px flex h-9 items-center border-b-2 border-transparent px-3 text-[12.5px] font-medium'
              }>
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'import-export' && <ImportExportTab />}
      {activeTab === 'trash' && <TrashTab />}
      {activeTab === 'settings' && <SettingsTab onLocaleChange={onLocaleChange} />}
    </div>
  );
};

/**
 * 表示ロケールを解決して `I18nProvider` を張るルート（U18）。設定タブでの言語変更は `applyLocale` で
 * 即時に Provider へ反映され、再読み込みなしで全文言が切り替わる。
 */
const Options = () => {
  const { locale, applyLocale } = useUiLocale();

  return (
    <I18nProvider locale={locale}>
      <OptionsBody onLocaleChange={applyLocale} />
    </I18nProvider>
  );
};

export default withErrorBoundary(Options, ErrorDisplay);
