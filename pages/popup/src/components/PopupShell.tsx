import type { ReactNode } from 'react';

interface PopupShellProps {
  header: ReactNode;
  sidebar: ReactNode;
  main: ReactNode;
}

/**
 * ポップアップの外枠（760×560・角丸12・影）と3領域レイアウト（docs/design ルートレイアウト）。
 * ヘッダー56 + ボディ（左ペイン220 + 右ペイン flex:1）。ペイン間に区切り線。
 * キーボード操作（U8 モード状態機械）は Popup が document レベルのリスナーで一元処理する。
 */
export const PopupShell = ({ header, sidebar, main }: PopupShellProps) => (
  <div className="bg-surface shadow-shell flex h-[560px] w-[760px] flex-col overflow-hidden rounded-xl">
    {header}
    <div className="flex min-h-0 flex-1">
      {/* `data-pane` は「押下位置がどちらのペインか」を DOM から判定するための目印（`alias-editor-close`）。
          別名編集中の外側クリックを、右ペイン=閉じてクリックを飲む / それ以外=閉じるだけ、に振り分ける。 */}
      <aside data-pane="folder" className="border-line bg-pane w-[220px] flex-none overflow-hidden border-r">
        {sidebar}
      </aside>
      <main data-pane="result" className="min-w-0 flex-1 overflow-hidden">
        {main}
      </main>
    </div>
  </div>
);
