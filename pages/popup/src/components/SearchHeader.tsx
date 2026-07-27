import { useEffect } from 'react';
import type { RefObject } from 'react';

interface SearchHeaderProps {
  query: string;
  onQueryChange: (q: string) => void;
  /** 検索入力への参照。起動時フォーカスと検索ファースト復帰のため親が保持する。 */
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * 固定ヘッダー（56px）。検索ボックス（h34・虫眼鏡・フォーカスリング）と「＋追加」ボタン。
 * 「＋追加」は U7 ではプレースホルダ（現在ページ登録は U14）。フォルダチップ（U11）は未実装。
 * キー割り当て（↑↓/Enter/Escape）は U8 のモード状態機械（Popup の document リスナー）に集約したため、
 * 本コンポーネントは自前のキー意味論を持たない。
 */
export const SearchHeader = ({ query, onQueryChange, inputRef }: SearchHeaderProps) => {
  // 起動直後に検索ボックスへフォーカスする（200ms 要件。データ読み込みとは独立して即時）。
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  return (
    <header className="border-line flex h-14 flex-none items-center gap-3 border-b px-[14px]">
      <div className="border-line-input bg-pane-2 focus-within:border-accent focus-within:shadow-focus-ring flex h-[34px] flex-1 items-center gap-2 rounded-md border px-[10px] focus-within:bg-white">
        {/* 虫眼鏡 14×14・stroke #9AA1AE（docs/design/README.md「1a」） */}
        <svg width="14" height="14" viewBox="0 0 14 14" className="flex-none" aria-hidden="true">
          <circle cx="6" cy="6" r="4.4" fill="none" stroke="#9AA1AE" strokeWidth="1.6" />
          <line x1="9.6" y1="9.6" x2="13" y2="13" stroke="#9AA1AE" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder="ブックマークを検索..."
          aria-label="ブックマークを検索"
          className="text-ink placeholder:text-ink-faint h-full flex-1 bg-transparent text-[13px] outline-none"
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
};
