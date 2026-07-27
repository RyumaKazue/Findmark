/**
 * Popup のモード状態機械（U8・純粋ロジック）。
 *
 * functional-design「画面遷移図(Popupのモード状態遷移)」「モード別のキー挙動」「共通ルール（検索ファースト）」を
 * 単一の source of truth として実装する。React / `chrome.*` に非依存の純粋関数群であり、`useMode`（React 層）と
 * ユニットテスト（`modeMachine.test.ts`）から利用する。既存の pure module（`folderTreeModel.ts`/`virtualization.ts`）に
 * 倣い、宣言は非 export とし、ファイル末尾で export をまとめる。
 *
 * キー割り当ての出典整合: モード入口は functional-design の修飾キー方式（F2/Ctrl+E・Ctrl+;・Ctrl+M）を採用する。
 * design README の素キー `E`/`A` は検索ファースト（文字を打つと検索ボックスに戻る）と衝突するため非採用。
 * 各モードの UI 実体は後続単位（U9 別名/U10 インライン/U12 パネル・D&D/U13 複数選択）が担い、本モジュールは
 * モードの遷移とキー意味論（インテント）のみを提供する。
 */

/** Popup のモード。既定は `LIST`。 */
type Mode = 'LIST' | 'INLINE_EDIT' | 'ALIAS_EDIT' | 'DRAG' | 'PANEL';

interface ModeState {
  mode: Mode;
  /** 編集/操作対象の行 ID（LIST/DRAG では null 可）。どの行を操作中かを後続単位へ伝える。 */
  targetId: string | null;
}

const initialModeState: ModeState = { mode: 'LIST', targetId: null };

type ModeAction =
  | { type: 'ENTER_INLINE_EDIT'; targetId: string }
  | { type: 'ENTER_ALIAS_EDIT'; targetId: string }
  | { type: 'ENTER_PANEL' }
  | { type: 'ENTER_DRAG'; targetId: string | null }
  | { type: 'EXIT_TO_LIST' };

/**
 * モード遷移リデューサ。functional-design 遷移図に従い、LIST↔各モードのみを許可する。
 * 編集/別名モードへの入口は LIST からのみ有効。不正な遷移（例: INLINE_EDIT 中に別モードへ直接遷移）は
 * 現状維持に倒す（防御的デフォルト）。DRAG は LIST からのみ開始できる。
 */
const modeReducer = (state: ModeState, action: ModeAction): ModeState => {
  switch (action.type) {
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
 * `list:escape` は「段階的な戻り」の起点で、実際の1手は `resolveListEscape` が文脈から決める。
 */
type KeyIntent =
  | 'none'
  | 'list:move-up'
  | 'list:move-down'
  | 'list:open'
  | 'list:escape'
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
 * 現在モードとキー入力からインテントを解決する（副作用なし）。
 * functional-design「モード別のキー挙動」表に忠実:
 * - LIST: 上下=選択移動 / Enter=開く / Escape=段階戻り（起点）
 * - INLINE_EDIT: Enter=確定 / Escape=破棄 / 上下=ネイティブのキャレット移動（none）
 * - ALIAS_EDIT: 上下=候補移動 / Enter=チップ確定 / Escape=編集終了
 * - PANEL: 上下=候補移動 / Enter=決定 / Escape=閉じる
 * - DRAG: Escape=中止のみ（上下/Enter は無効）
 */
const resolveKeyIntent = (mode: Mode, e: KeyLike): KeyIntent => {
  switch (mode) {
    case 'LIST':
      if (e.key === 'ArrowDown') return 'list:move-down';
      if (e.key === 'ArrowUp') return 'list:move-up';
      // 修飾なし Enter のみ「開く」。Ctrl/Cmd+Enter（新規タブ）は将来単位のため none に倒す。
      if (e.key === 'Enter') return hasCommandModifier(e) ? 'none' : 'list:open';
      if (e.key === 'Escape') return 'list:escape';
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

/** LIST の Escape 段階戻りの文脈。 */
interface ListEscapeContext {
  /** 検索キーワードが入力されているか。 */
  hasQuery: boolean;
  /** フォルダ絞り込み（スコープ）が有効か。 */
  hasScope: boolean;
}

type ListEscapeAction = 'clear-keyword' | 'clear-scope' | 'close';

/**
 * LIST の Escape を1段階ずつ解決する（functional-design LIST 行「段階的に戻る」）。
 * 優先順位: キーワードクリア → フォルダ絞り込み解除 → 閉じる。
 */
const resolveListEscape = (ctx: ListEscapeContext): ListEscapeAction => {
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
 * 検索ファースト復帰の対象外モード判定（functional-design「共通ルール: 編集モード中を除き…」）。
 * 自前の文字入力 UI を持つモード（インライン編集・別名編集・フォルダ選択パネル）では、印字文字を検索ボックスへ
 * 奪わない。これを純粋関数に集約することで、後続単位（U12 PANEL 等）は Popup 側のハードコード判定を編集せずに済む。
 */
const isSearchFirstExempt = (mode: Mode): boolean =>
  mode === 'INLINE_EDIT' || mode === 'ALIAS_EDIT' || mode === 'PANEL';

/** モード入口ショートカットの意図（対象行 ID は呼び出し側が与える）。 */
type ShortcutIntent = 'inline-edit' | 'alias-edit' | 'panel';

/**
 * モード入口ショートカットの定義（ドキュメント兼マッチング用の単一集約）。
 * functional-design 遷移図に準拠。letter 系は mac 互換のため Ctrl/Cmd の両方を受ける。
 */
const SHORTCUTS = {
  inlineEdit: 'F2 / Ctrl(Cmd)+E',
  aliasEdit: 'Ctrl(Cmd)+;',
  panel: 'Ctrl(Cmd)+M',
} as const;

/**
 * LIST でのモード入口ショートカットを解決する（対象未確定のため意図のみ返す）。
 * 呼び出し側が現在の対象行 ID を添えて `enterInlineEdit`/`enterAliasEdit`/`enterPanel` を呼ぶ。
 */
const resolveShortcutIntent = (e: KeyLike): ShortcutIntent | null => {
  // F2 は修飾なし。
  if (e.key === 'F2' && !e.altKey) return 'inline-edit';
  const cmd = hasCommandModifier(e);
  if (!cmd || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'e') return 'inline-edit';
  if (key === ';') return 'alias-edit';
  if (key === 'm') return 'panel';
  return null;
};

export {
  initialModeState,
  modeReducer,
  resolveKeyIntent,
  resolveListEscape,
  isPrintableKey,
  isSearchFirstExempt,
  SHORTCUTS,
  resolveShortcutIntent,
};
export type {
  Mode,
  ModeState,
  ModeAction,
  KeyIntent,
  KeyLike,
  ListEscapeContext,
  ListEscapeAction,
  PrintableKeyLike,
  ShortcutIntent,
};
