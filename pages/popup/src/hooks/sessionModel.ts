/**
 * ポップアップ状態の復元（U19・機能13）の純粋ロジック。
 *
 * React / `chrome.*` に非依存の純粋関数群であり、`Popup`（オーケストレーション層）とユニットテスト
 * （`sessionModel.test.ts`）から利用する。既存の pure module（`modeMachine.ts` / `folderTreeModel.ts`）に倣い、
 * 宣言は非 export とし、ファイル末尾で export をまとめる。
 *
 * 責務は「既定値」「削除済み参照のフォールバック解決」「現在状態からのセッション導出」「等値比較」に限る。
 * 永続化（読み書き）はデータ層（`localStateStore`）、DOM フォーカス操作は `Popup` が担う。
 */
import type { PopupSession } from '@extension/storage';

/**
 * 初回起動時（未保存）の既定セッション（functional-design「State Management」の既定値）。
 * フォーカス位置=左ペイン / スコープ=「すべて」/ 選択行=先頭行（`selectedBookmarkId` 未指定）/ クエリ=空。
 */
const DEFAULT_SESSION: PopupSession = {
  focusArea: 'folderTree',
  scopeFolderId: null,
  query: '',
};

/**
 * 復元時のスコープを解決する（AC-5）。保存フォルダが存在しなければ「すべて」（null）へフォールバックする。
 * `focusArea` はこの結果に影響されない（呼び出し側で保存値のまま復元する）。
 *
 * @param sessionScope 保存されていたスコープ（null = 「すべて」）
 * @param exists そのフォルダが現在のツリーに存在するか（呼び出し側が検証して渡す）
 */
const resolveRestoredScope = (sessionScope: string | null, exists: boolean): string | null =>
  sessionScope !== null && exists ? sessionScope : null;

/**
 * 復元時の選択行インデックスを解決する（AC-6/AC-8）。保存ブックマーク ID を現在の検索結果 ID 列から引く。
 * 未指定（先頭行既定）または見つからない（削除済み）場合は先頭行（0）へフォールバックする。
 *
 * @param id 保存されていた選択ブックマーク ID（未指定なら先頭行）
 * @param resultIds 現在の検索結果の node.id 列（表示順）
 */
const resolveRestoredIndex = (id: string | undefined, resultIds: readonly string[]): number => {
  if (id === undefined) {
    return 0;
  }
  const index = resultIds.indexOf(id);
  return index >= 0 ? index : 0;
};

/** `deriveSession` の入力（現在の UI 状態）。 */
interface DeriveSessionInput {
  focusArea: PopupSession['focusArea'];
  scopeFolderId: string | null;
  /** 現在選択中の行のブックマーク ID（選択不能・結果0件なら undefined）。 */
  selectedBookmarkId: string | undefined;
  query: string;
}

/**
 * 現在の UI 状態から保存用の `PopupSession` を組み立てる（AC-1/AC-2）。
 * `selectedBookmarkId` が undefined のときはキー自体を省く（既定=先頭行 と等価に保つ）。
 */
const deriveSession = (input: DeriveSessionInput): PopupSession => {
  const session: PopupSession = {
    focusArea: input.focusArea,
    scopeFolderId: input.scopeFolderId,
    query: input.query,
  };
  if (input.selectedBookmarkId !== undefined) {
    session.selectedBookmarkId = input.selectedBookmarkId;
  }
  return session;
};

/**
 * 2つのセッションが 4 項目すべて等しいか判定する。保存 effect が無駄な書き込み・`liveUpdate` の
 * 再通知を出さないためのガードに使う。`selectedBookmarkId` は未指定同士も等値とみなす。
 */
const sessionsEqual = (a: PopupSession, b: PopupSession): boolean =>
  a.focusArea === b.focusArea &&
  a.scopeFolderId === b.scopeFolderId &&
  a.query === b.query &&
  a.selectedBookmarkId === b.selectedBookmarkId;

export { DEFAULT_SESSION, resolveRestoredScope, resolveRestoredIndex, deriveSession, sessionsEqual };
export type { DeriveSessionInput };
