import {
  MAX_ALIASES,
  MAX_ALIAS_LENGTH,
  commitAlias,
  orderMatchedFirst,
  removeAt,
  removeLast,
} from './aliasEditorModel.js';
import { normalizer } from '@extension/shared';
import { cn } from '@extension/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

interface AliasEditorProps {
  /** 編集対象ブックマークの URL（別名紐付けキーの元）。 */
  url: string;
  /** 編集開始時の別名（原文）。 */
  initialAliases: string[];
  /** 検索でマッチした別名（先頭ハイライト・省略対象外）。 */
  matchedAliases: string[];
  /** 別名が変化するたびに呼ばれる永続化コールバック（楽観更新→失敗で呼び出し側がロールバックを促す）。 */
  onCommit: (aliases: string[]) => Promise<void> | void;
  /** 編集終了（Escape 等）。呼び出し側で ALIAS_EDIT を抜ける。 */
  onClose: () => void;
}

/** 重複ハイライト（blink）の表示時間。 */
const BLINK_MS = 450;
/** 上限到達フラッシュの表示時間。 */
const LIMIT_FLASH_MS = 600;

/** ASCII のみ（ローマ字/英数字）の別名は monospace で表示する（docs/design。ResultRow と同方針）。 */
const isAscii = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) {
      return false;
    }
  }
  return true;
};

const normalize = (s: string): string => normalizer.normalizeText(s);

/**
 * 別名チップ編集（U9・デザイン状態1e）。結果行の 2 段目に差し込まれ、既存別名の追加/削除/再編集を行う。
 *
 * キー意味論: Enter/`,`/Space で確定、空入力の Backspace で末尾チップ削除、Escape で編集終了。
 * IME 変換中（`isComposing`）の確定キーは無視し、日本語別名の変換確定を誤ってチップ化しない。
 * 確定/重複/上限/削除の判定は純粋モジュール `aliasEditorModel` に委譲し、本コンポーネントは
 * 表示・フォーカス・楽観更新（`onCommit`）・一時的な視覚効果（blink/上限フラッシュ）のみを担う。
 */
export const AliasEditor = ({ url, initialAliases, matchedAliases, onCommit, onClose }: AliasEditorProps) => {
  const [chips, setChips] = useState<string[]>(() => orderMatchedFirst(initialAliases, matchedAliases));
  const [input, setInput] = useState('');
  const [blinkIndex, setBlinkIndex] = useState<number | null>(null);
  const [limitFlash, setLimitFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const matchedSet = useMemo(() => new Set(matchedAliases), [matchedAliases]);

  // マウント時に入力欄へフォーカス（別名エリアクリック/ショートカットからの遷移で即入力可能に）。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // アンマウント時にタイマーを掃除する（setState after unmount を防ぐ）。
  useEffect(
    () => () => {
      clearTimeout(blinkTimer.current);
      clearTimeout(limitTimer.current);
    },
    [],
  );

  const triggerBlink = useCallback((index: number) => {
    setBlinkIndex(index);
    clearTimeout(blinkTimer.current);
    blinkTimer.current = setTimeout(() => setBlinkIndex(null), BLINK_MS);
  }, []);

  const flashLimit = useCallback(() => {
    setLimitFlash(true);
    clearTimeout(limitTimer.current);
    limitTimer.current = setTimeout(() => setLimitFlash(false), LIMIT_FLASH_MS);
  }, []);

  // 楽観更新: 先に表示を更新し、永続化に失敗したら直前状態へロールバックする。
  const persist = useCallback(
    (prev: string[], next: string[]) => {
      setChips(next);
      Promise.resolve(onCommit(next)).catch((e: unknown) => {
        console.error('[AliasEditor] 別名の保存に失敗しました:', e);
        setChips(prev);
      });
    },
    [onCommit],
  );

  const handleCommit = useCallback(() => {
    const outcome = commitAlias(chips, input, normalize);
    switch (outcome.type) {
      case 'added':
        setInput('');
        persist(chips, outcome.aliases);
        break;
      case 'duplicate':
        // 既存チップと正規化一致。追加せず該当チップを一瞬光らせる（UC-2）。
        setInput('');
        triggerBlink(outcome.index);
        break;
      case 'empty':
        setInput('');
        break;
      case 'too-long':
      case 'at-limit':
        // 入力は消さず（ユーザーが直せるよう）、上限表示を強調する。
        flashLimit();
        break;
    }
  }, [chips, input, persist, triggerBlink, flashLimit]);

  // `✕` による個別削除（明示的な削除意思）。即時に永続化する。
  const removeChip = useCallback(
    (index: number) => {
      persist(chips, removeAt(chips, index));
      inputRef.current?.focus();
    },
    [chips, persist],
  );

  // 空入力 Backspace による末尾削除（明示的な削除意思）。即時に永続化する。
  const removeLastChip = useCallback(() => {
    persist(chips, removeLast(chips));
    inputRef.current?.focus();
  }, [chips, persist]);

  // チップクリックで入力欄へ戻して再編集。ここでは永続化せず、ローカル state からのみ取り除く。
  // 誤クリック後に確定せず離脱（Escape 等）してもストレージの別名を失わない（別名削除にアンドゥが無いため）。
  const editChip = useCallback(
    (index: number) => {
      const value = chips[index];
      setChips(prev => removeAt(prev, index));
      setInput(value);
      inputRef.current?.focus();
    },
    [chips],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      // IME 変換確定の Enter/Space をチップ確定に使わない（日本語別名対応）。
      if (e.nativeEvent.isComposing) {
        return;
      }
      // AliasEditor が処理するキーは、document レベルの LIST キーハンドラ（Popup）へ伝播させない。
      // React の stopPropagation は内部で nativeEvent.stopPropagation() を呼ぶため、document の
      // ネイティブリスナーにも届かなくなる。これがないと、閉じる操作の Enter がそのまま「開く」に化ける。
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        // 空入力での Enter は「入力終了」とみなして別名編集を閉じる（確定対象が無いため）。
        if (input.trim() === '') {
          onClose();
          return;
        }
        handleCommit();
        return;
      }
      if (e.key === ',' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        handleCommit();
        return;
      }
      if (e.key === 'Backspace' && input === '' && chips.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        removeLastChip();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [handleCommit, input, chips.length, removeLastChip, onClose],
  );

  return (
    <div className="flex flex-col gap-1">
      {/* チップ入力ボックス（状態1e: radius 8・border 1.5px accent + focus ring・flex-wrap）。
          別名が多い/長い場合の縦伸びを抑えるため max-h + 内部スクロールで高さを有界化する
          （右ペインの仮想スクロールは固定行高前提のため、編集行の膨張を一定範囲に留める）。 */}
      <div className="border-accent shadow-focus-ring flex max-h-[68px] flex-wrap items-center gap-1.5 overflow-y-auto rounded-lg border-[1.5px] bg-white px-2 py-1.5">
        {chips.map((alias, i) => {
          const isMatched = matchedSet.has(alias);
          return (
            <span
              key={`${alias}-${i}`}
              className={cn(
                'flex flex-none items-center gap-1 rounded-full py-[2px] pl-2 pr-1 text-[11px] font-medium leading-[15px]',
                isMatched ? 'bg-accent text-white' : 'bg-accent-bg text-accent-strong',
                isAscii(alias) && 'font-mono',
                blinkIndex === i && 'ring-accent-strong ring-2',
              )}>
              <button
                type="button"
                onClick={() => editChip(i)}
                title="クリックで再編集"
                className="max-w-[160px] truncate">
                {alias}
              </button>
              <button
                type="button"
                onClick={() => removeChip(i)}
                aria-label={`別名「${alias}」を削除`}
                className={cn(
                  'flex-none rounded-full px-[3px] leading-none',
                  isMatched ? 'text-white/80 hover:text-white' : 'text-accent-strong/70 hover:text-accent-strong',
                )}>
                ✕
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={MAX_ALIAS_LENGTH}
          placeholder={chips.length === 0 ? '別名を追加…' : ''}
          aria-label={`別名を編集（${url}）`}
          className="text-ink placeholder:text-ink-faint h-[18px] min-w-[80px] flex-1 bg-transparent text-[12px] outline-none"
        />
      </div>

      {/* ヒント文（左）と上限表示（右）。 */}
      <div className="flex items-center justify-between px-1">
        <span className="text-ink-faint text-[11px]">Enter で確定 / Backspace で直前のチップを削除</span>
        <span className={cn('font-mono text-[11px]', limitFlash ? 'text-danger font-bold' : 'text-ink-faint')}>
          {chips.length} / {MAX_ALIASES}
        </span>
      </div>
    </div>
  );
};
