import '@src/Options.css';
import { withErrorBoundary } from '@extension/shared';
import { ErrorDisplay } from '@extension/ui';
import { ImportExportTab } from '@src/components/ImportExportTab';
import { SettingsTab } from '@src/components/SettingsTab';
import { TrashTab } from '@src/components/TrashTab';
import { useState } from 'react';

type TabId = 'import-export' | 'trash' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'import-export', label: 'インポート / エクスポート' },
  { id: 'trash', label: 'ゴミ箱' },
  { id: 'settings', label: '設定' },
];

/**
 * オプションページのルート（U15 でインポート/エクスポートを実装、U16 でタブ機構・ゴミ箱・設定を追加）。
 * ポップアップに置けない機能（ファイルダイアログを要するインポート/エクスポート、削除データの
 * 復元、保持日数・locale の設定）をここに集約する。
 *
 * タブは3つのみで外部依存を増やす必要がないため、ルーターは導入せず `useState` の最小構成にする。
 */
const Options = () => {
  const [activeTab, setActiveTab] = useState<TabId>('import-export');

  return (
    <div className="bg-pane min-h-screen">
      <div className="border-line bg-surface sticky top-0 z-10 border-b">
        <div role="tablist" aria-label="オプション" className="mx-auto flex max-w-[640px] gap-1 px-6 pt-3">
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
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'import-export' && <ImportExportTab />}
      {activeTab === 'trash' && <TrashTab />}
      {activeTab === 'settings' && <SettingsTab />}
    </div>
  );
};

export default withErrorBoundary(Options, ErrorDisplay);
