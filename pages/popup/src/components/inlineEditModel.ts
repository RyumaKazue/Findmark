/**
 * インライン編集（リネーム/URL編集）の純粋ロジック（U10・React/DOM 非依存）。
 *
 * URL のバリデーションと、下書き（draft）から実際に呼ぶべき更新内容を決める確定判定を提供し、
 * `InlineEdit`（React 層）とユニットテスト（`inlineEditModel.test.ts`）の双方から使う。
 * 既存の pure module（`aliasEditorModel.ts`/`folderTreeModel.ts`/`modeMachine.ts`）に倣い、
 * 宣言は非 export とし、ファイル末尾で export をまとめる。
 */

/** URL 検証結果（判別可能ユニオン）。`ok:false` の `message` はそのままインラインエラーに表示する。 */
type UrlValidation = { ok: true } | { ok: false; message: string };

/** ブックマークとして保存させないスキーム（スクリプト実行につながるため・development-guidelines）。 */
const FORBIDDEN_SCHEMES = ['javascript:', 'data:'];

/**
 * URL を検証する（純粋）。
 * 判定順: 空/空白のみ → パース不能（スキームなしを含む）→ 禁止スキーム → それ以外は許可。
 * `chrome://` 等の非 http(s) スキームも許可する（既存ブックマークが持ち得るため）。
 */
const validateUrl = (raw: string): UrlValidation => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: 'URLを入力してください' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: 'URLの形式が正しくありません' };
  }
  if (FORBIDDEN_SCHEMES.includes(parsed.protocol)) {
    return { ok: false, message: 'このスキームのURLは登録できません' };
  }
  return { ok: true };
};

/** インライン編集フォームの下書き（タイトル・URL）。 */
interface EditDraft {
  title: string;
  url: string;
}

/**
 * 確定計画（判別可能ユニオン）。
 * - `invalid`: URL が不正。確定不可（chrome API を呼ばない）。
 * - `unchanged`: 元の値と差分なし。API を呼ばず編集モードを閉じるだけ。
 * - `update`: 変化したフィールドのみを含む更新内容。
 */
type CommitPlan =
  | { type: 'invalid'; message: string }
  | { type: 'unchanged' }
  | { type: 'update'; title?: string; url?: string };

/**
 * 元の値と下書きの差分から確定計画を決める（純粋）。
 * タイトルは前後の空白を trim して比較・確定する。URL 検証を先に行い、不正なら他の差分を無視して
 * `invalid` を返す（受け入れ条件「URL不正で確定不可」）。
 */
const planCommit = (original: EditDraft, draft: EditDraft): CommitPlan => {
  const validation = validateUrl(draft.url);
  if (!validation.ok) {
    return { type: 'invalid', message: validation.message };
  }

  const nextTitle = draft.title.trim();
  const nextUrl = draft.url.trim();
  const titleChanged = nextTitle !== original.title.trim();
  const urlChanged = nextUrl !== original.url.trim();

  if (!titleChanged && !urlChanged) {
    return { type: 'unchanged' };
  }

  const update: { title?: string; url?: string } = {};
  if (titleChanged) {
    update.title = nextTitle;
  }
  if (urlChanged) {
    update.url = nextUrl;
  }
  return { type: 'update', ...update };
};

export { validateUrl, planCommit };
export type { UrlValidation, EditDraft, CommitPlan };
