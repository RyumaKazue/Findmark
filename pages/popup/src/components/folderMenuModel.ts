/**
 * 左ペイン（フォルダ）の右クリックメニューの純粋ロジック（`folder-rename-create`）。
 *
 * React / `chrome.*` に非依存の純粋関数群であり、`Popup`（結線層）とユニットテスト（`folderMenuModel.test.ts`）
 * から利用する。既存の pure module（`rowMenuModel.ts` / `folderDeleteModel.ts`）に倣い、宣言は非 export とし、
 * ファイル末尾で export をまとめる。
 *
 * **本モジュールの目的は `rowMenuModel` と同じ**「項目の並びと、出す/無効にする条件を1箇所に閉じる」こと。
 * `folder-delete` の時点ではフォルダメニューは項目1つだったため `Popup.tsx` の JSX 直書きで足りたが、
 * 本単位で3項目 + 無効条件 + 区切り線になる。これを JSX 内の三項演算子に書くと、テストの当てられない場所に
 * 分岐が溜まっていく。
 *
 * 名前（フォルダ名）の検証と確定判定も本モジュールが持つ。`inlineEditModel`（ブックマークのタイトル/URL）と
 * 対になる位置づけで、UI 層（`PromptDialog`）は「空かどうか」しか知らずに済む。
 */

import type { LocalizedMessage } from '../lib/message.js';

/** フォルダメニューの項目キー（`Popup` 側で実行を分岐する識別子）。 */
type FolderMenuKey = 'create' | 'rename' | 'delete';

/** メニュー項目の表示属性（ラベルは持たない。i18n は呼び出し側が `key` から引く）。 */
interface FolderMenuItemSpec {
  key: FolderMenuKey;
  /** 破壊的操作か（危険色で表示する）。 */
  danger?: boolean;
  /** この項目の上に区切り線を描くか。 */
  separatorBefore?: boolean;
  /** 選べない項目か（フォーカスはできるが実行されない）。 */
  disabled?: boolean;
}

/** `buildFolderMenuItems` の判定文脈。Popup 側が右クリック対象から組み立てる値オブジェクト。 */
interface FolderMenuContext {
  /**
   * 最上位フォルダ（「ブックマーク バー」「その他のブックマーク」等＝ツリーの `depth === 0`）か。
   *
   * Chrome はルート直下のフォルダに対する `update` / `removeTree` を拒否するため、名前変更と削除を無効にする。
   * **作成は拒否されない**（最上位フォルダの直下にサブフォルダは作れる）ため制限しない。これは同時に、
   * 「すべて」行にメニューを持たせなくても全階層にフォルダを作れる根拠でもある。
   */
  isTopLevel: boolean;
}

/**
 * フォルダメニューの項目を並び順で返す。
 *
 * 並びは `rowMenuModel.buildRowMenuItems` と同じ規律で「非破壊 → 破壊」とし、`delete` の上に区切り線を入れて
 * 視覚的に離す（勢いで押してしまうのを減らす）。無効項目も**配列から落とさず** `disabled` で残す。項目が
 * 消えると並びが対象ごとに変わり、「さっきと同じ位置を押したのに違う操作が走る」ことになるため。
 */
const buildFolderMenuItems = (ctx: FolderMenuContext): FolderMenuItemSpec[] => [
  { key: 'create' },
  { key: 'rename', disabled: ctx.isTopLevel },
  { key: 'delete', danger: true, separatorBefore: true, disabled: ctx.isTopLevel },
];

/** フォルダ名の検証結果（`inlineEditModel.UrlValidation` と同じ形）。 */
type FolderTitleValidation = { ok: true } | { ok: false; message: LocalizedMessage };

/**
 * フォルダ名を検証する（純粋）。判定は「trim 後が空でないこと」だけ。
 *
 * - **同名チェックは行わない**: Chrome 自身が同名フォルダを許可しており、ここだけ禁止すると操作が通らない
 *   理由をユーザーが説明できない。`folder-scope-descendants` 以降スコープ判定は ID で行うため、同名でも
 *   取り違えは起きない。
 * - **文字数上限も設けない**: Chrome 側に上限が無く、独自に切ると保存された内容と表示が食い違う。
 */
const validateFolderTitle = (raw: string): FolderTitleValidation =>
  raw.trim().length === 0 ? { ok: false, message: { key: 'popupErrorFolderNameRequired' } } : { ok: true };

/**
 * 名前変更の確定計画（`inlineEditModel.CommitPlan` と同じ判別可能ユニオン）。
 * - `invalid`: 空・空白のみ。確定不可（chrome API を呼ばない）。
 * - `unchanged`: 元の名前と差分なし。API を呼ばずにダイアログを閉じるだけ（索引の再構築も起こさない）。
 * - `update`: trim 済みの新しい名前。
 */
type RenamePlan =
  | { type: 'invalid'; message: LocalizedMessage }
  | { type: 'unchanged' }
  | { type: 'update'; title: string };

/**
 * 元の名前と入力値から確定計画を決める（純粋）。
 *
 * 検証を先に行い、不正なら差分を見ずに `invalid` を返す（`inlineEditModel.planCommit` と同じ順序）。
 * 比較は**双方を trim してから**行う。前後の空白だけを足した入力を「変更あり」と扱うと、実データは同じなのに
 * 索引の再構築（リネーム後の `reloadIndex`）だけが走ってしまう。
 */
const planRename = (originalTitle: string, raw: string): RenamePlan => {
  const validation = validateFolderTitle(raw);
  if (!validation.ok) {
    return { type: 'invalid', message: validation.message };
  }
  const nextTitle = raw.trim();
  return nextTitle === originalTitle.trim() ? { type: 'unchanged' } : { type: 'update', title: nextTitle };
};

export { buildFolderMenuItems, validateFolderTitle, planRename };
export type { FolderMenuKey, FolderMenuItemSpec, FolderMenuContext, FolderTitleValidation, RenamePlan };
