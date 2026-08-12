import { withUI } from '@extension/ui';

/**
 * デザイントークン（色・影）は popup（`pages/popup/tailwind.config.ts`）と同じ値を写し、拡張全体で
 * 配色に一貫性を持たせる（U15 で初めて Options に実 UI が入るため導入する）。フォント（woff2 同梱）は
 * popup 固有のアセットバンドルに依存するため、本単位ではスコープ外とし既定フォントのままにする。
 */
export default withUI({
  content: ['index.html', 'src/**/*.tsx'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#4F6BED',
          hover: '#3A54C9',
          strong: '#3D51C4',
          bar: '#2E3C8F',
          bg: '#EEF1FD',
          'bg-selected': '#E4E9FB',
        },
        surface: '#FFFFFF',
        pane: '#FBFBFC',
        'pane-2': '#F7F8FA',
        'pane-3': '#FAFBFC',
        'input-bg': '#FCFCFD',
        'row-selected': '#F4F6FE',
        ink: {
          DEFAULT: '#1F2430',
          2: '#444B59',
          soft: '#6B7280',
          faint: '#9AA1AE',
        },
        line: {
          DEFAULT: '#E7E9EE',
          input: '#E4E7EC',
          row: '#EFF1F4',
          dashed: '#C7CBD4',
        },
        danger: {
          DEFAULT: '#C0392B',
          border: '#E1C4C4',
        },
      },
      boxShadow: {
        shell: '0 10px 34px rgba(31,36,48,0.14), 0 1px 3px rgba(31,36,48,0.08)',
        'focus-ring': '0 0 0 3px rgba(79,107,237,0.12)',
      },
    },
  },
});
