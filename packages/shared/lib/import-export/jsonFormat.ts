/**
 * 独自JSON形式（`format: "my-bookmark-search"`）のスキーマ定義とパース/シリアライズ（U15）。
 *
 * ブラウザ描画・React・chrome API・DOM に依存しない純粋関数の集合であり、`ImportExportService`
 * とユニットテスト（`jsonFormat.test.ts`）から利用する（architecture.md のレイヤー依存の起点）。
 *
 * ファイル上の日時（`exportedAt`/`addedAt`）は人が読める ISO8601 文字列で保持し、内部表現
 * （`ImportBookmark`/`ExportBookmark`）では扱いやすい epoch ms（number）に変換する。
 * `version` は将来のフォーマット変更後も旧ファイルを読めるよう、バージョンごとに分岐できる形にしておく
 * （PRD 機能11「`version` により将来のフォーマット変更後も旧ファイルを読める設計とする」）。
 */

/** 独自JSONの識別子。 */
const FORMAT_ID = 'my-bookmark-search';
/** 現行スキーマの version。 */
const CURRENT_VERSION = 1;

/** インポート対象の1件（独自JSON/HTML共通の中間表現。functional-design 準拠）。 */
interface ImportBookmark {
  url: string;
  title: string;
  /** 上位→末端のフォルダ名。無ければ `ensureFolderPath` で自動作成する。 */
  folderPath: string[];
  /** HTMLインポート時は常に空配列。 */
  aliases: string[];
  /** epoch ms（任意）。ファイル上は ISO8601 文字列。パース失敗時は省略する。 */
  addedAt?: number;
}

/** エクスポート対象の1件。フィールド構成は `ImportBookmark` と同一（対称性のため型を分ける）。 */
interface ExportBookmark {
  url: string;
  title: string;
  folderPath: string[];
  aliases: string[];
  addedAt?: number;
}

/** 独自JSONのファイル形式が不正（`format`/`version`/構造）なときに投げる。 */
class InvalidImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImportFormatError';
  }
}

/** 値がオブジェクトであることの型ガード（`unknown` を安全に絞り込むためのローカルヘルパ）。 */
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * `version: 1` の `bookmarks[]` 要素1件をパースする。`url`/`title` が string でない要素は
 * ファイル全体を壊さないよう `null` を返し、呼び出し側で除外する（他の要素は影響を受けない）。
 */
const parseBookmarkV1 = (raw: unknown): ImportBookmark | null => {
  if (!isRecord(raw) || typeof raw.url !== 'string' || typeof raw.title !== 'string') {
    return null;
  }
  const folderPath = Array.isArray(raw.folderPath)
    ? raw.folderPath.filter((s): s is string => typeof s === 'string')
    : [];
  const aliases = Array.isArray(raw.aliases) ? raw.aliases.filter((s): s is string => typeof s === 'string') : [];
  let addedAt: number | undefined;
  if (typeof raw.addedAt === 'string') {
    const parsed = Date.parse(raw.addedAt);
    addedAt = Number.isNaN(parsed) ? undefined : parsed;
  }
  return { url: raw.url, title: raw.title, folderPath, aliases, addedAt };
};

/**
 * 生テキストが独自JSON（`format: "my-bookmark-search"`）らしいかを判定する。
 * ファイル選択ダイアログは拡張子を強制できない（「すべてのファイル」から拡張子違いのファイルを選べる）ため、
 * 呼び出し側（`pages/options` の `ImportExportTab`）が拡張子に加えて内容でも独自JSON/標準HTMLを判定できる
 * ようにする。壊れたJSON・`format` 不一致はいずれも `false`（例外を投げない。判定専用のため）。
 */
const isMyBookmarkSearchFile = (rawText: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(rawText);
    return isRecord(parsed) && parsed.format === FORMAT_ID;
  } catch {
    return false;
  }
};

/**
 * 生JSON文字列を検証し `ImportBookmark[]` へ変換する。
 * `format`/`version` が不正、または JSON として解釈できない場合は `InvalidImportFormatError` を投げる
 * （functional-design「エラーハンドリング」: パース失敗は中断・部分適用しない）。
 */
const parseJsonFile = (rawText: string): ImportBookmark[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new InvalidImportFormatError('JSON として解析できません');
  }
  if (!isRecord(parsed) || parsed.format !== FORMAT_ID) {
    throw new InvalidImportFormatError(`format が不正です（"${FORMAT_ID}" である必要があります）`);
  }
  if (typeof parsed.version !== 'number') {
    throw new InvalidImportFormatError('version が不正です');
  }
  if (!Array.isArray(parsed.bookmarks)) {
    throw new InvalidImportFormatError('bookmarks が不正です');
  }

  // version ごとに分岐する（将来のフォーマット変更時はここへ case を追加する）。
  const bookmarksRaw = parsed.bookmarks;
  switch (parsed.version) {
    case 1: {
      return bookmarksRaw.map(parseBookmarkV1).filter((b): b is ImportBookmark => b !== null);
    }
    default:
      throw new InvalidImportFormatError(`未対応の version です: ${String(parsed.version)}`);
  }
};

/** 現行 version（`CURRENT_VERSION`）で独自JSON文字列を生成する。 */
const serializeJsonFile = (bookmarks: ExportBookmark[]): string => {
  const file = {
    format: FORMAT_ID,
    version: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    bookmarks: bookmarks.map(b => ({
      url: b.url,
      title: b.title,
      folderPath: b.folderPath,
      aliases: b.aliases,
      ...(b.addedAt !== undefined ? { addedAt: new Date(b.addedAt).toISOString() } : {}),
    })),
  };
  return JSON.stringify(file, null, 2);
};

export {
  FORMAT_ID,
  CURRENT_VERSION,
  InvalidImportFormatError,
  isMyBookmarkSearchFile,
  parseJsonFile,
  serializeJsonFile,
};
export type { ImportBookmark, ExportBookmark };
