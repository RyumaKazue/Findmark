import { planCommit, validateUrl } from './inlineEditModel.js';
import { cn } from '@extension/ui';
import { resolveKeyIntent } from '@src/hooks/modeMachine';
import { useEffect, useRef, useState } from 'react';
import type { CommitPlan, EditDraft } from './inlineEditModel.js';
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

interface InlineEditProps {
  original: EditDraft;
  onCommit: (plan: CommitPlan) => void;
  onCancel: () => void;
}

/**
 * インライン編集フォーム（U10・デザイン状態1d）。タイトル入力と URL 入力を同時展開し、
 * モーダルを使わずその場でリネーム/URL編集を完結させる。
 *
 * キーの意味論は `modeMachine.resolveKeyIntent('INLINE_EDIT', e)` から取得し、キー割り当てを
 * 再発明しない（U8 の single source of truth を維持）。フォームが処理するキーは
 * `stopPropagation` して document レベルの LIST ハンドラへ伝播させない（`AliasEditor` と同じ規律）。
 *
 * 別名チップ列は非採用（別名編集は U9 の `AliasEditor` が担当。二重実装を避ける）。
 */
export const InlineEdit = ({ original, onCommit, onCancel }: InlineEditProps) => {
  const [draft, setDraft] = useState<EditDraft>(original);
  const [urlError, setUrlError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // マウント時にタイトル入力へフォーカス + 全選択（リネームの主用途は書き換えのため）。
  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const commit = () => {
    const plan = planCommit(original, draft);
    if (plan.type === 'invalid') {
      setUrlError(plan.message);
      return;
    }
    onCommit(plan);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) {
      return;
    }
    const intent = resolveKeyIntent('INLINE_EDIT', e);
    if (intent === 'inline:confirm') {
      e.preventDefault();
      e.stopPropagation();
      commit();
      return;
    }
    if (intent === 'inline:discard') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  const handleUrlChange = (value: string) => {
    setDraft(prev => ({ ...prev, url: value }));
    const validation = validateUrl(value);
    setUrlError(validation.ok ? null : validation.message);
  };

  // フォーム全体からフォーカスが外れたときのみ確定する（Tab によるタイトル⇄URL間の
  // 内部移動では確定しない）。relatedTarget が null（ポップアップが閉じる等）も「外へ出た」とみなす。
  const handleBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) {
      return;
    }
    commit();
  };

  return (
    <div
      onBlur={handleBlur}
      className="shadow-edit-row flex flex-col gap-[10px] rounded-md bg-white p-[14px]"
      data-testid="inline-edit">
      <div className="flex items-center gap-2">
        <input
          ref={titleRef}
          type="text"
          value={draft.title}
          onChange={e => setDraft(prev => ({ ...prev, title: e.target.value }))}
          onKeyDown={handleKeyDown}
          aria-label="タイトルを編集"
          className="border-accent shadow-focus-ring text-ink h-[34px] flex-1 rounded-md border-[1.5px] bg-white px-2.5 text-[13px] font-medium outline-none"
        />
      </div>
      <div>
        <input
          type="text"
          value={draft.url}
          onChange={e => handleUrlChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="URLを編集"
          aria-invalid={urlError !== null}
          className={cn(
            'bg-input-bg text-ink-2 h-8 w-full rounded-md border px-2.5 font-mono text-[12px] outline-none',
            urlError ? 'border-danger' : 'border-line-input',
          )}
        />
        {urlError && <p className="text-danger mt-1 text-[11px]">{urlError}</p>}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="border-line text-ink-soft h-7 rounded-md border px-3 text-[12px] font-bold">
          キャンセル
        </button>
        <button
          type="button"
          onClick={commit}
          className="bg-accent h-7 rounded-md px-3 text-[12px] font-bold text-white">
          保存
        </button>
      </div>
    </div>
  );
};
