import { formatPath } from './folderTreeModel.js';
import type { RefObject } from 'react';

interface SearchHeaderProps {
  query: string;
  onQueryChange: (q: string) => void;
  /** 検索入力への参照。検索ファースト復帰・↑↓離脱のため親が保持する。 */
  inputRef: RefObject<HTMLInputElement | null>;
  /**
   * スコープの可視化用パス（圧縮済み・null = すべて）。非 null のとき検索ボックス先頭にフォルダチップを表示する。
   * チップは**表示専用**（`✕` なし・操作主体ではない）。解除は Escape の段階戻り、「すべて」復帰は Home が担う（U11）。
   */
  scopePath?: string[] | null;
}

/**
 * 固定ヘッダー（56px）。検索ボックス（h34・虫眼鏡・フォーカスリング）と「＋追加」ボタン。
 * 「＋追加」は U7 ではプレースホルダ（現在ページ登録は U14）。
 *
 * U11: スコープ中は検索ボックス先頭に表示専用のフォルダチップ（`📁` + 圧縮パス）を出す。起動時の自動フォーカスは
 * 廃止し（既定フォーカスは左ペイン = FOLDER_TREE）、フォーカス制御は Popup が一元管理する。
 * キー割り当て（↑↓/Enter/Escape）は U8 のモード状態機械（Popup の document リスナー）に集約している。
 */
export const SearchHeader = ({ query, onQueryChange, inputRef, scopePath = null }: SearchHeaderProps) => (
  <header className="border-line flex h-14 flex-none items-center gap-3 border-b px-[14px]">
    <div className="border-line-input bg-pane-2 focus-within:border-accent focus-within:shadow-focus-ring flex h-[34px] flex-1 items-center gap-2 rounded-md border px-[10px] focus-within:bg-white">
      {/* 虫眼鏡 14×14・stroke #9AA1AE（docs/design/README.md「1a」） */}
      <svg width="14" height="14" viewBox="0 0 14 14" className="flex-none" aria-hidden="true">
        <circle cx="6" cy="6" r="4.4" fill="none" stroke="#9AA1AE" strokeWidth="1.6" />
        <line x1="9.6" y1="9.6" x2="13" y2="13" stroke="#9AA1AE" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {/* スコープ可視化チップ（表示専用・`✕` なし。design 1b）。 */}
      {scopePath !== null && (
        <span className="bg-accent-bg text-accent-strong flex h-[22px] flex-none items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium">
          <span aria-hidden="true">📁</span>
          {formatPath(scopePath)}
        </span>
      )}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        placeholder="ブックマークを検索..."
        aria-label="ブックマークを検索"
        className="text-ink placeholder:text-ink-faint h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none"
      />
    </div>
    <button
      type="button"
      title="現在のページを追加（U14 で実装）"
      className="bg-accent flex h-[34px] flex-none items-center gap-1.5 rounded-md px-[14px] text-[12.5px] font-bold text-white">
      <span aria-hidden="true">＋</span>追加
    </button>
  </header>
);
