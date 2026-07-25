import { withUI } from '@extension/ui';

/**
 * デザイントークンは docs/design/README.md「Design Tokens」を正として写す（U7）。
 * ポップアップの視覚仕様（レイアウト・寸法・色・タイポグラフィ・角丸・影）は docs/design/ を正とする。
 * 将来 packages/ui へ昇格して Options でも共有可能。
 *
 * 角丸は Tailwind 既定（rounded=4px / rounded-md=6px / rounded-lg=8px / rounded-xl=12px / rounded-full）が
 * docs/design の 4/6/8/12/999 と一致するため既定を用いる。26px などの一回性の値は arbitrary（例: pl-[26px]）で扱う。
 */
export default withUI({
  content: ['index.html', 'src/**/*.tsx'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#4F6BED', // primary
          hover: '#3A54C9',
          strong: '#3D51C4', // チップ文字
          bar: '#2E3C8F', // 一括バー文字
          bg: '#EEF1FD', // チップ・一括バー薄背景
          'bg-selected': '#E4E9FB', // 選択行内チップ
        },
        surface: '#FFFFFF',
        pane: '#FBFBFC', // 左ペイン背景
        'pane-2': '#F7F8FA', // 検索ボックス背景
        'pane-3': '#FAFBFC', // hover 行背景・メタ行
        'input-bg': '#FCFCFD',
        'row-selected': '#F4F6FE',
        'row-top': '#FAFBFF', // 最有力行背景
        ink: {
          DEFAULT: '#1F2430', // 主テキスト
          2: '#444B59',
          soft: '#6B7280', // 副テキスト
          faint: '#9AA1AE', // 弱テキスト
        },
        line: {
          DEFAULT: '#E7E9EE', // 構造罫線
          input: '#E4E7EC',
          row: '#EFF1F4', // 行間罫線
          dashed: '#C7CBD4',
          'dashed-2': '#D3D7DE',
        },
        triangle: '#C2C6CF', // 折りたたみ三角
        'chip-muted': {
          bg: '#F1F2F5', // 省略チップ
          text: '#9AA1AE',
        },
        danger: {
          DEFAULT: '#C0392B',
          border: '#E1C4C4',
        },
      },
      fontFamily: {
        sans: ["'Noto Sans JP'", 'system-ui', 'sans-serif'],
        mono: ["'IBM Plex Mono'", 'monospace'],
      },
      boxShadow: {
        shell: '0 10px 34px rgba(31,36,48,0.14), 0 1px 3px rgba(31,36,48,0.08)',
        'edit-row': '0 2px 10px rgba(31,36,48,0.06)',
        'drag-ghost': '0 12px 26px rgba(31,36,48,0.22)',
        'focus-ring': '0 0 0 3px rgba(79,107,237,0.12)',
        'focus-ring-strong': '0 0 0 3px rgba(79,107,237,0.16)',
      },
    },
  },
});
