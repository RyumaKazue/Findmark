/**
 * 結果行（ブックマーク）の右クリックメニューの純粋ロジック（`row-context-menu`）。
 *
 * React / `chrome.*` に非依存の純粋関数群であり、`Popup`（結線層）とユニットテスト（`rowMenuModel.test.ts`）
 * から利用する。既存の pure module（`folderDeleteModel.ts` / `selectionModel.ts`）に倣い、宣言は非 export とし、
 * ファイル末尾で export をまとめる。
 *
 * **本モジュールの目的は「項目の並びと出す/出さないの条件を1箇所に閉じる」こと**。`folder-delete` の
 * フォルダメニューは項目1つだったため `Popup.tsx` の JSX へ直書きで足りたが、行メニューは4項目 + 区切り +
 * 抑止条件を持つ。これを JSX 内の三項演算子に書くと、テストの当てられない場所に分岐が溜まっていく
 * （`modeMachine.isShortcutEnabled` を純粋関数へ切り出したのと同じ理由）。
 */

/** 行メニューの項目キー（`Popup` 側で実行を分岐する識別子）。 */
type RowMenuKey = 'edit' | 'alias-edit' | 'move' | 'delete';

/** `canOpenRowMenu` の判定文脈。Popup 側の state をそのまま写した値オブジェクト。 */
interface RowMenuContext {
  /**
   * 選択モード中か（`selectionModel.active`）。
   * 選択モード中の行操作は一括操作バー（移動/削除）が担うという役割分担のため、メニューは出さない。
   */
  selectionMode: boolean;
  /** 対象行が存在するか（結果0件・インデックス範囲外に対する防御）。 */
  hasTarget: boolean;
}

/** メニュー項目の表示属性（ラベルは持たない。i18n は呼び出し側が `key` から引く）。 */
interface RowMenuItemSpec {
  key: RowMenuKey;
  /** 破壊的操作か（危険色で表示する）。 */
  danger?: boolean;
  /** この項目の上に区切り線を描くか。 */
  separatorBefore?: boolean;
}

/** 行メニューを開いてよいか。 */
const canOpenRowMenu = (ctx: RowMenuContext): boolean => !ctx.selectionMode && ctx.hasTarget;

/**
 * 行メニューの項目を並び順で返す。
 *
 * 並びは「よく使う・非破壊」→「破壊的」の順にし、`delete` の上に区切り線を入れて視覚的に離す
 * （勢いで押してしまうのを減らすため。確認ダイアログを持たない操作なので、5秒アンドゥだけが最後の砦になる）。
 *
 * 現時点で引数を取らない固定配列だが関数として置く。将来「URL の無い行では編集を無効にする」等の条件が
 * 入る場所をここ1箇所に決めておくため（項目の組み立てが JSX へ散るのを防ぐのが本モジュールの役割）。
 */
const buildRowMenuItems = (): RowMenuItemSpec[] => [
  { key: 'edit' },
  { key: 'alias-edit' },
  { key: 'move' },
  { key: 'delete', danger: true, separatorBefore: true },
];

export { canOpenRowMenu, buildRowMenuItems };
export type { RowMenuKey, RowMenuContext, RowMenuItemSpec };
