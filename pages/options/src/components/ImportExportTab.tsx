import { ConflictDialog } from './ConflictDialog.js';
import { InvalidImportFormatError, isMyBookmarkSearchFile } from '@extension/shared';
import { importExportService } from '@src/services';
import { useRef, useState } from 'react';
import type { ConflictResolution, ConflictResolver, ImportBookmark, ImportReport } from '@extension/shared';
import type { BookmarkNode } from '@extension/storage';
import type { ChangeEvent } from 'react';

/** 解決待ちの競合1件（`ConflictDialog` の表示に必要な情報）。 */
interface PendingConflict {
  existing: BookmarkNode;
  existingFolderPath: string[];
  incoming: ImportBookmark;
  /** 何件目の競合か（1始まり）。 */
  count: number;
}

/** テキストをファイルとしてダウンロードさせる（`packages/shared` は DOM 非依存のため Blob 化はここで行う）。 */
const download = (filename: string, content: string, mimeType: string): void => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const REPORT_ROWS: { key: keyof Omit<ImportReport, 'total' | 'errors'>; label: string }[] = [
  { key: 'created', label: '新規作成' },
  { key: 'aliasMerged', label: '別名マージ' },
  { key: 'skipped', label: 'スキップ' },
  { key: 'overwritten', label: '上書き' },
  { key: 'keptBoth', label: '両方残す' },
];

/**
 * インポート/エクスポート タブ（U15・PRD 機能11）。
 *
 * エクスポートは `ImportExportService.exportJson/exportHtml`（文字列）を受け取り、ここで初めて
 * `Blob`/`<a download>` に包んでダウンロードをトリガーする（`packages/shared` の DOM API 依存禁止のため）。
 *
 * インポートは **「ファイルを選択」→ 選択内容を表示 →「実行」** の2段階にする。ファイルを選んだだけでは
 * 取り込まず、`[実行]` を押して初めて `importJson`/`importHtml` を呼ぶ（インポートは既存ブックマークを
 * 変更しうる操作のため、誤選択がそのまま実行されないようにする）。形式は拡張子＋内容（`format` フィールド）で
 * 判定し、独自JSONの競合（タイトル/フォルダ相違）は `ConflictDialog` を表示してユーザーの選択を `Promise` で
 * 待つ `ConflictResolver` を実装する。
 */
export const ImportExportTab = () => {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  /** 選択済みのファイル（未選択は null）。[実行] を押すまでインポートは走らせない。 */
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // ネイティブの `<input type="file">` は「選択されていません」の文言・見た目を制御できないため、
  // input 自体は視覚的に隠し、ラベル代わりのボタンから `click()` して選択ダイアログを開く。
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingResolveRef = useRef<((result: { resolution: ConflictResolution; applyToAll: boolean }) => void) | null>(
    null,
  );
  const conflictCountRef = useRef(0);

  // `ConflictDialog` の選択を待つ resolver。ダイアログの onResolve が呼ばれるまで importJson 側は
  // 待機し続ける（Promise の resolve 関数を ref に保持する定石パターン）。
  const resolver: ConflictResolver = {
    resolve: (existing, existingFolderPath, incoming) =>
      new Promise(resolve => {
        conflictCountRef.current += 1;
        pendingResolveRef.current = resolve;
        setConflict({ existing, existingFolderPath, incoming, count: conflictCountRef.current });
      }),
  };

  const handleDialogResolve = (resolution: ConflictResolution, applyToAll: boolean): void => {
    pendingResolveRef.current?.({ resolution, applyToAll });
    pendingResolveRef.current = null;
    setConflict(null);
  };

  const handleExportJson = async (): Promise<void> => {
    const text = await importExportService.exportJson();
    download('findmark-bookmarks.json', text, 'application/json');
  };

  const handleExportHtml = async (): Promise<void> => {
    const text = await importExportService.exportHtml();
    download('findmark-bookmarks.html', text, 'text/html');
  };

  // ファイル選択のみを行い、インポートは実行しない（実行は [実行] ボタン＝ `handleImport`）。
  // 誤ってファイルを選んだだけで破壊的な取り込みが走らないよう、選択と実行を明確に分ける。
  const handleFileSelected = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ''; // 同じファイルを連続で選び直せるようにする（File 実体は state 側で保持する）
    if (!file) {
      return;
    }
    setSelectedFile(file);
    // 前回の実行結果は選び直した時点で古くなるためクリアする。
    setError(null);
    setReport(null);
  };

  const handleImport = async (): Promise<void> => {
    if (!selectedFile) {
      return;
    }
    setError(null);
    setReport(null);
    setBusy(true);
    conflictCountRef.current = 0;
    try {
      const text = await selectedFile.text();
      // 拡張子に加え内容（format フィールド）でも判定する。ファイル選択ダイアログの「すべてのファイル」から
      // 拡張子違いで選ばれても正しく振り分けられるようにする（実装検証で拡張子のみの判定を指摘されたため）。
      const isJson = selectedFile.name.toLowerCase().endsWith('.json') || isMyBookmarkSearchFile(text);
      const result = isJson
        ? await importExportService.importJson(text, resolver)
        : await importExportService.importHtml(text);
      setReport(result);
    } catch (err) {
      console.error('[ImportExportTab] インポートに失敗しました:', err);
      // functional-design「エラーハンドリング」: パース失敗は中断・専用メッセージ。
      setError(
        err instanceof InvalidImportFormatError
          ? 'ファイル形式が不正です(format/version を確認)'
          : 'インポートに失敗しました',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[640px] p-6">
      <h1 className="text-ink mb-4 text-[18px] font-bold">インポート / エクスポート</h1>

      <section className="border-line mb-4 rounded-lg border p-4">
        <h2 className="text-ink mb-2 text-[13px] font-bold">エクスポート</h2>
        {/* 枠内で2つのボタンを等幅・等間隔に配置する（grid-cols-2 + gap）。 */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void handleExportJson()}
            className="bg-accent flex h-9 w-full items-center justify-center rounded-md px-4 text-[12.5px] font-bold text-white">
            独自JSONをエクスポート
          </button>
          <button
            type="button"
            onClick={() => void handleExportHtml()}
            className="border-line hover:bg-pane-3 flex h-9 w-full items-center justify-center rounded-md border px-4 text-[12.5px] font-medium">
            標準HTMLをエクスポート
          </button>
        </div>
      </section>

      <section className="border-line rounded-lg border p-4">
        <h2 className="text-ink mb-2 text-[13px] font-bold">インポート</h2>
        <p className="text-ink-soft mb-2 text-[11.5px]">
          独自JSON(.json)または標準HTML(.html)のファイルを選択し、[実行]を押してください。
        </p>

        {/* 実体の input は隠し、下のボタンから click() して選択ダイアログを開く（見た目を制御するため）。 */}
        <input ref={fileInputRef} type="file" accept=".json,.html" className="hidden" onChange={handleFileSelected} />

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="border-line hover:bg-pane-3 text-ink flex h-9 flex-none items-center rounded-md border px-4 text-[12.5px] font-medium disabled:opacity-50">
            ファイルを選択
          </button>

          {/* 選択状態の可視化: 未選択はグレーの補助テキスト、選択済みは accent の淡背景＋ファイル名で明示する。 */}
          {selectedFile ? (
            <span
              title={selectedFile.name}
              className="bg-accent-bg text-accent-strong flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium">
              <span aria-hidden="true">📄</span>
              <span className="truncate">{selectedFile.name}</span>
            </span>
          ) : (
            <span className="text-ink-faint flex h-9 flex-1 items-center px-1 text-[12.5px]">
              ファイルが選択されていません
            </span>
          )}

          <button
            type="button"
            disabled={busy || selectedFile === null}
            onClick={() => void handleImport()}
            className="bg-accent flex h-9 flex-none items-center rounded-md px-5 text-[12.5px] font-bold text-white disabled:opacity-40">
            {busy ? '実行中…' : '実行'}
          </button>
        </div>

        {error && <p className="text-danger mt-3 text-[12.5px]">{error}</p>}

        {report && (
          <div className="border-line-row bg-pane-3 mt-4 rounded-md border p-3 text-[12.5px]">
            <p className="text-ink font-bold">インポート結果（合計 {report.total}件）</p>
            <ul className="text-ink-soft mt-1 space-y-0.5">
              {REPORT_ROWS.map(row => (
                <li key={row.key}>
                  {row.label}: {report[row.key]}件
                </li>
              ))}
              {report.errors.length > 0 && <li className="text-danger">失敗: {report.errors.length}件</li>}
            </ul>
          </div>
        )}
      </section>

      {conflict && (
        <ConflictDialog
          existing={{ title: conflict.existing.title, folderPath: conflict.existingFolderPath }}
          incoming={{ title: conflict.incoming.title, folderPath: conflict.incoming.folderPath }}
          count={conflict.count}
          onResolve={handleDialogResolve}
        />
      )}
    </div>
  );
};
