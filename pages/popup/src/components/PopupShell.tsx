import type { ReactNode } from 'react';

interface PopupShellProps {
  header: ReactNode;
  sidebar: ReactNode;
  main: ReactNode;
}

/**
 * ポップアップの外枠（760×560・角丸12・影）と3領域レイアウト（docs/design ルートレイアウト）。
 * ヘッダー56 + ボディ（左ペイン220 + 右ペイン flex:1）。ペイン間に区切り線。
 */
export const PopupShell = ({ header, sidebar, main }: PopupShellProps) => (
  <div className="bg-surface shadow-shell flex h-[560px] w-[760px] flex-col overflow-hidden rounded-xl">
    {header}
    <div className="flex min-h-0 flex-1">
      <aside className="border-line bg-pane w-[220px] flex-none overflow-hidden border-r">{sidebar}</aside>
      <main className="min-w-0 flex-1 overflow-hidden">{main}</main>
    </div>
  </div>
);
