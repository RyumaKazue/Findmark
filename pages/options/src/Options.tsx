import '@src/Options.css';
import { withErrorBoundary } from '@extension/shared';
import { ErrorDisplay } from '@extension/ui';
import { ImportExportTab } from '@src/components/ImportExportTab';

/**
 * オプションページのルート（U15）。ポップアップに置けない機能（ファイルダイアログを要するインポート/
 * エクスポート）をここに集約する。U7 が Popup のボイラープレートを置換したのと同じ扱いで、U15 が
 * Options のデモUI（`exampleThemeStorage`/ロゴ）を置換する。将来 U16 でゴミ箱・設定タブを追加する際は
 * タブ切り替えの土台をここへ導入する（現時点では ImportExportTab 単体のため過剰な先取りをしない）。
 */
const Options = () => (
  <div className="bg-pane min-h-screen">
    <ImportExportTab />
  </div>
);

export default withErrorBoundary(Options, ErrorDisplay);
