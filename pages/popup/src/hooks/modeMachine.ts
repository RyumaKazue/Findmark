/**
 * Popup のモード状態機械（U8・純粋ロジック。U8a でフォーカス3状態を追加）。
 *
 * functional-design「画面遷移図(Popupのモード状態遷移)」「既定モードのキー挙動（フォーカス位置別）」
 * 「Escape の段階戻り（4段階）」「共通ルール（検索ファースト）」を単一の source of truth として実装する。
 * React / `chrome.*` に非依存の純粋関数群であり、`useMode`（React 層）とユニットテスト（`modeMachine.test.ts`）
 * から利用する。既存の pure module（`folderTreeModel.ts`/`virtualization.ts`）に倣い、宣言は非 export とし、
 * ファイル末尾で export をまとめる。
 *
 * キー割り当ての出典整合: モード入口は functional-design の修飾キー方式（F2/Ctrl+E・Ctrl+;・Ctrl+M）を採用する。
 * design README の素キー `E`/`A` は検索ファースト（文字を打つと検索ボックスに戻る）と衝突するため非採用。
 * 各モードの UI 実体は後続単位（U9 別名/U10 インライン/U12 パネル・D&D/U13 複数選択）が担い、本モジュールは
 * モードの遷移とキー意味論（インテント）のみを提供する。
 *
 * U8a（フォーカス3状態）: Popup のキーボードフォーカスは検索ボックス/右ペイン/左ペインの3箇所を行き来する。
 * `LIST` モード内のフォーカス位置は `ListFocus` で表し、`FOLDER_TREE` モードは左ペインを表す。統合的な
 * フォーカス位置は `FocusArea` として `toFocusArea(mode, listFocus)` で導出する（二重管理を避けるため独立した
 * state として持たない）。左ペイン内の実ナビゲーション（どのフォルダにフォーカスが当たるか・スコープ追従・
 * 展開/折りたたみの実行）は U11 が担い、本単位はインテントの定義までに留める。
 */

/** Popup のモード。既定は `LIST`。`FOLDER_TREE` は左ペイン操作中（U8a で追加）。 */
type Mode = 'LIST' | 'FOLDER_TREE' | 'INLINE_EDIT' | 'ALIAS_EDIT' | 'DRAG' | 'PANEL';

/**
 * `LIST` モード内のフォーカス位置（U8a）。`FOLDER_TREE` では左ペインが自明のため参照しない。
 * DOM フォーカスの実体（`<input>` の focus/blur）は Popup が保持し、本値は意味論のみを表す。
 */
type ListFocus = 'search' | 'result';

/**
 * キー意味論・Escape 段階戻りが参照する統合フォーカス位置（U8a）。
 * `mode` と `listFocus` の2箇所が食い違わないよう、独立した state として持たず必ず導出する。
 */
type FocusArea = 'search' | 'result' | 'folderTree';

/** `mode` と `listFocus` から統合フォーカス位置を導出する（U8a）。 */
const toFocusArea = (mode: Mode, listFocus: ListFocus): FocusArea =>
  mode === 'FOLDER_TREE' ? 'folderTree' : listFocus;

interface ModeState {
  mode: Mode;
  /** 編集/操作対象の行 ID（LIST/FOLDER_TREE/DRAG では null 可）。どの行を操作中かを後続単位へ伝える。 */
  targetId: string | null;
}

const initialModeState: ModeState = { mode: 'LIST', targetId: null };

type ModeAction =
  | { type: 'ENTER_FOLDER_TREE' }
  | { type: 'ENTER_INLINE_EDIT'; targetId: string }
  | { type: 'ENTER_ALIAS_EDIT'; targetId: string }
  | { type: 'ENTER_PANEL' }
  | { type: 'ENTER_DRAG'; targetId: string | null }
  | { type: 'EXIT_TO_LIST' };

/**
 * モード遷移リデューサ。functional-design 遷移図に従い、LIST↔各モードのみを許可する。
 * 編集/別名/フォルダツリーモードへの入口は LIST からのみ有効。不正な遷移（例: INLINE_EDIT 中に
 * 別モードへ直接遷移）は現状維持に倒す（防御的デフォルト）。DRAG は LIST からのみ開始できる。
 */
const modeReducer = (state: ModeState, action: ModeAction): ModeState => {
  switch (action.type) {
    case 'ENTER_FOLDER_TREE':
      return state.mode === 'LIST' ? { mode: 'FOLDER_TREE', targetId: null } : state;
    case 'ENTER_INLINE_EDIT':
      return state.mode === 'LIST' ? { mode: 'INLINE_EDIT', targetId: action.targetId } : state;
    case 'ENTER_ALIAS_EDIT':
      return state.mode === 'LIST' ? { mode: 'ALIAS_EDIT', targetId: action.targetId } : state;
    case 'ENTER_PANEL':
      return state.mode === 'LIST' ? { mode: 'PANEL', targetId: null } : state;
    case 'ENTER_DRAG':
      return state.mode === 'LIST' ? { mode: 'DRAG', targetId: action.targetId } : state;
    case 'EXIT_TO_LIST':
      return state.mode === 'LIST' ? state : initialModeState;
    default:
      return state;
  }
};

/**
 * モードごとのキー意味論。UI はこの結果（インテント）を実行するだけにし、キー衝突ロジックを再発明しない。
 * `escape:step-back` は「段階的な戻り」の起点で、実際の1手は `resolveEscapeStep` が文脈から決める
 * （LIST と FOLDER_TREE が同じ段階戻りの梯子を共有するため `list:` 接頭辞を外した名称にしている）。
 */
type KeyIntent =
  | 'none'
  // LIST + 検索ボックス（U8a）。↑↓ は検索欄を離脱しつつ選択行を1つ動かす。
  | 'list:leave-search-up'
  | 'list:leave-search-down'
  // LIST + 右ペイン（U8a）。
  | 'list:move-up'
  | 'list:move-down'
  | 'list:to-folder-tree'
  // LIST 共通。
  | 'list:open'
  // FOLDER_TREE（U8a）。実行結線は U11（本単位は定義のみ）。
  | 'folder:move-up'
  | 'folder:move-down'
  | 'folder:parent'
  | 'folder:to-result'
  | 'folder:toggle-expand'
  | 'folder:home'
  // LIST / FOLDER_TREE 共通の Escape 起点。
  | 'escape:step-back'
  | 'inline:confirm'
  | 'inline:discard'
  | 'alias:candidate-up'
  | 'alias:candidate-down'
  | 'alias:confirm'
  | 'alias:exit'
  | 'panel:candidate-up'
  | 'panel:candidate-down'
  | 'panel:confirm'
  | 'panel:close'
  | 'drag:cancel';

/** `KeyboardEvent` の必要最小限の形（テスト容易性のため構造的に受ける）。 */
interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const hasCommandModifier = (e: KeyLike): boolean => Boolean(e.ctrlKey) || Boolean(e.metaKey);

/**
 * 現在モード・キー入力・（LIST の場合の）フォーカス位置からインテントを解決する（副作用なし）。
 * `listFocus` は LIST 以外のモードでは参照されないため省略可能（既定 `'search'`）。U10 で
 * `InlineEdit` が `resolveKeyIntent('INLINE_EDIT', e)` を第3引数なしで呼ぶために追加した。
 * functional-design「既定モードのキー挙動（フォーカス位置別）」「編集モードのキー挙動」表に忠実:
 * - LIST + 検索ボックス: ↑↓=検索欄を離脱しつつ選択行を1つ動かす / ←→・Home=none（ネイティブのキャレット移動・
 *   クエリ途中の修正を温存するため、意図的に何も割り当てない）/ Enter=開く / Escape=段階戻り（起点）
 * - LIST + 右ペイン: ↑↓=選択行の移動 / ←=左ペインへ / →=none / Enter=開く / Escape=段階戻り（起点）
 * - FOLDER_TREE: ↑↓=フォルダ間移動 / ←=親フォルダへ / →=右ペインへ / Enter=展開トグル / Home=「すべて」へ /
 *   Escape=段階戻り（起点）。実行結線は U11（本単位はインテントの定義のみ）
 * - INLINE_EDIT: Enter=確定 / Escape=破棄 / 上下=ネイティブのキャレット移動（none）
 * - ALIAS_EDIT: 上下=候補移動 / Enter=チップ確定 / Escape=編集終了
 * - PANEL: 上下=候補移動 / Enter=決定 / Escape=閉じる
 * - DRAG: Escape=中止のみ（上下/Enter は無効）
 */
const resolveKeyIntent = (mode: Mode, e: KeyLike, listFocus: ListFocus = 'search'): KeyIntent => {
  switch (mode) {
    case 'LIST':
      if (listFocus === 'search') {
        // ←→・Home は意図的に none（キャレット移動・クエリ途中の修正を奪わない）。
        if (e.key === 'ArrowDown') return 'list:leave-search-down';
        if (e.key === 'ArrowUp') return 'list:leave-search-up';
        if (e.key === 'Enter') return hasCommandModifier(e) ? 'none' : 'list:open';
        if (e.key === 'Escape') return 'escape:step-back';
        return 'none';
      }
      // listFocus === 'result'
      if (e.key === 'ArrowDown') return 'list:move-down';
      if (e.key === 'ArrowUp') return 'list:move-up';
      if (e.key === 'ArrowLeft') return 'list:to-folder-tree';
      // 修飾なし Enter のみ「開く」。Ctrl/Cmd+Enter（新規タブ）は将来単位のため none に倒す。
      if (e.key === 'Enter') return hasCommandModifier(e) ? 'none' : 'list:open';
      if (e.key === 'Escape') return 'escape:step-back';
      return 'none';
    case 'FOLDER_TREE':
      if (e.key === 'ArrowDown') return 'folder:move-down';
      if (e.key === 'ArrowUp') return 'folder:move-up';
      if (e.key === 'ArrowLeft') return 'folder:parent';
      if (e.key === 'ArrowRight') return 'folder:to-result';
      if (e.key === 'Enter') return 'folder:toggle-expand';
      if (e.key === 'Home') return 'folder:home';
      if (e.key === 'Escape') return 'escape:step-back';
      return 'none';
    case 'INLINE_EDIT':
      if (e.key === 'Enter') return 'inline:confirm';
      if (e.key === 'Escape') return 'inline:discard';
      return 'none';
    case 'ALIAS_EDIT':
      if (e.key === 'ArrowUp') return 'alias:candidate-up';
      if (e.key === 'ArrowDown') return 'alias:candidate-down';
      if (e.key === 'Enter') return 'alias:confirm';
      if (e.key === 'Escape') return 'alias:exit';
      return 'none';
    case 'PANEL':
      if (e.key === 'ArrowUp') return 'panel:candidate-up';
      if (e.key === 'ArrowDown') return 'panel:candidate-down';
      if (e.key === 'Enter') return 'panel:confirm';
      if (e.key === 'Escape') return 'panel:close';
      return 'none';
    case 'DRAG':
      return e.key === 'Escape' ? 'drag:cancel' : 'none';
    default:
      return 'none';
  }
};

/** Escape 段階戻りの文脈（U8a でフォーカス位置を追加し4段階化）。 */
interface EscapeContext {
  /** 現在の統合フォーカス位置（`toFocusArea` の結果）。 */
  focusArea: FocusArea;
  /** 検索キーワードが入力されているか。 */
  hasQuery: boolean;
  /** フォルダ絞り込み（スコープ）が有効か。 */
  hasScope: boolean;
}

type EscapeStep = 'focus-search' | 'clear-keyword' | 'clear-scope' | 'close';

/**
 * Escape を1段階ずつ解決する（functional-design「Escape の段階戻り（4段階）」）。
 * 優先順位: 検索ボックス以外にフォーカス → 検索ボックスへ戻す → キーワードクリア →
 * フォルダ絞り込み解除 → 閉じる。LIST/FOLDER_TREE のどちらからも同じ梯子を辿る。
 */
const resolveEscapeStep = (ctx: EscapeContext): EscapeStep => {
  if (ctx.focusArea !== 'search') return 'focus-search';
  if (ctx.hasQuery) return 'clear-keyword';
  if (ctx.hasScope) return 'clear-scope';
  return 'close';
};

/** `KeyboardEvent` の印字判定に必要な最小の形（IME 変換中の判定を含む）。 */
interface PrintableKeyLike extends KeyLike {
  /** IME 変換中か（変換中の入力は検索ファーストの起点にしない）。 */
  isComposing?: boolean;
}

/**
 * 検索ファースト用の印字文字判定（functional-design「共通ルール」）。
 * 修飾キー（Ctrl/Cmd/Alt）付き・IME 変換中・機能キー（Enter/Tab/Arrow 等）は印字とみなさない。
 * `key.length === 1` により `'a'` / `'あ'` / `' '`（スペース）等の単一文字だけを印字とする。
 */
const isPrintableKey = (e: PrintableKeyLike): boolean => {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.isComposing) return false;
  return e.key.length === 1;
};

/**
 * 検索ファースト復帰のトリガーとなるキー判定（U8a）。印字文字（`isPrintableKey`）に加え、修飾なしの
 * `Backspace` も検索ボックスへの復帰トリガーとする。左/右ペインで「消したい」と思って Backspace を押した
 * ときにも検索ボックスへ戻れるようにするため（printable と同じ「フォーカス移動後に発火した既定動作が
 * 新しくフォーカスされた input に対して適用される」ブラウザの挙動に乗せ、`query` を明示的に書き換えない）。
 */
const isSearchFirstTriggerKey = (e: PrintableKeyLike): boolean => {
  if (isPrintableKey(e)) return true;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.isComposing) return false;
  return e.key === 'Backspace';
};

/**
 * 検索ファースト復帰の対象外モード判定（functional-design「共通ルール: 編集モード中を除き…」）。
 * 自前の文字入力 UI を持つモード（インライン編集・別名編集・フォルダ選択パネル）では、印字文字を検索ボックスへ
 * 奪わない。これを純粋関数に集約することで、後続単位（U12 PANEL 等）は Popup 側のハードコード判定を編集せずに済む。
 *
 * `DRAG`（U12）も対象にする: ドラッグ中に何かキーが押されても検索ボックスへフォーカスを飛ばさない
 * （ドラッグ操作の一貫性を保つ。中止は `resolveKeyIntent('DRAG', e)` の `drag:cancel`=Escape が担う）。
 *
 * `FOLDER_TREE` は意図的に対象外にしない（＝検索ファースト対象）。左ペインで文字を打つと検索ボックスへ復帰する
 * （U8a・functional-design「共通ルール」でフォーカス3状態全体に適用される）。
 */
const isSearchFirstExempt = (mode: Mode): boolean =>
  mode === 'INLINE_EDIT' || mode === 'ALIAS_EDIT' || mode === 'PANEL' || mode === 'DRAG';

/**
 * モード入口ショートカットの意図（対象行 ID は呼び出し側が与える）。
 * `delete`/`undo`（U10）はモード遷移を伴わないため厳密には「モード入口」ではないが、
 * 対象未確定のまま LIST で解決するという性質が同じため同じ関数・型に含める。
 */
type ShortcutIntent = 'inline-edit' | 'alias-edit' | 'panel' | 'delete' | 'undo' | 'select-all' | 'add-current';

/**
 * モード入口ショートカットの定義（ドキュメント兼マッチング用の単一集約）。
 * functional-design 遷移図に準拠。letter 系は mac 互換のため Ctrl/Cmd の両方を受ける。
 */
const SHORTCUTS = {
  inlineEdit: 'F2 / Ctrl(Cmd)+E',
  aliasEdit: 'Ctrl(Cmd)+;',
  panel: 'Ctrl(Cmd)+M',
  delete: 'Delete',
  undo: 'Ctrl(Cmd)+Z',
  selectAll: 'Ctrl(Cmd)+A',
  addCurrent: 'Ctrl(Cmd)+D',
} as const;

/**
 * LIST でのモード入口ショートカット・行操作ショートカットを解決する（対象未確定のため意図のみ返す）。
 * 呼び出し側が現在の対象行 ID を添えて `enterInlineEdit`/`enterAliasEdit`/`enterPanel` を呼ぶか、
 * `delete`/`undo` の場合はフォーカス位置・アンドゥ保持の有無を見て実行する（U10・Popup 側の責務）。
 */
const resolveShortcutIntent = (e: KeyLike): ShortcutIntent | null => {
  // F2 は修飾なし。
  if (e.key === 'F2' && !e.altKey) return 'inline-edit';
  // Delete は修飾なし（呼び出し側でフォーカス位置により有効/無効を判断する）。
  if (e.key === 'Delete' && !hasCommandModifier(e) && !e.altKey && !e.shiftKey) return 'delete';
  const cmd = hasCommandModifier(e);
  if (!cmd || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'e') return 'inline-edit';
  if (key === ';') return 'alias-edit';
  if (key === 'm') return 'panel';
  // Ctrl/Cmd+Z のみをアンドゥとする（Shift 付き = やり直しは未定義のため区別して弾く）。
  if (key === 'z' && !e.shiftKey) return 'undo';
  // Ctrl/Cmd+A（U13）。検索ボックスのネイティブなテキスト全選択を奪わないための listFocus 判定は
  // 呼び出し側（Popup）の責務とする（本関数は対象未確定のままインテントのみを返す）。
  if (key === 'a' && !e.shiftKey) return 'select-all';
  // Ctrl/Cmd+D（U14・現在ページ追加）。対象行を問わない操作のため、他のショートカットと異なり
  // 呼び出し側は `results.length` に関わらず常に有効にしてよい。
  if (key === 'd' && !e.shiftKey) return 'add-current';
  return null;
};

export {
  initialModeState,
  modeReducer,
  toFocusArea,
  resolveKeyIntent,
  resolveEscapeStep,
  isPrintableKey,
  isSearchFirstTriggerKey,
  isSearchFirstExempt,
  SHORTCUTS,
  resolveShortcutIntent,
};
export type {
  Mode,
  ListFocus,
  FocusArea,
  ModeState,
  ModeAction,
  KeyIntent,
  KeyLike,
  EscapeContext,
  EscapeStep,
  PrintableKeyLike,
  ShortcutIntent,
};
