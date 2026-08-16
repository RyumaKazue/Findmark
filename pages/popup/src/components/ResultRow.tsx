import { AliasEditor } from './AliasEditor.js';
import { Favicon } from './Favicon.js';
import { InlineEdit } from './InlineEdit.js';
import { useI18n } from '@extension/i18n';
import { cn } from '@extension/ui';
import type { CommitPlan, EditDraft } from './inlineEditModel.js';
import type { SearchResultItem } from '@extension/shared';
import type { MouseEvent } from 'react';

interface ResultRowProps {
  item: SearchResultItem;
  /** 選択中（↑↓/ホバーのハイライト対象）か。 */
  selected: boolean;
  /** 右ペイン（結果リスト）がキーボードフォーカスを持つか（AC-14 の相互アクセント用）。 */
  resultFocused?: boolean;
  /** この行が別名編集中（ALIAS_EDIT の対象）か。 */
  editingAlias?: boolean;
  /** この行がインライン編集中（INLINE_EDIT の対象）か。 */
  editingInline?: boolean;
  /** 他の行が編集中（別名/インラインいずれか）で、この行を薄暗くするか。 */
  dimmed?: boolean;
  /** クリックで開く。 */
  onOpen: () => void;
  /**
   * ホバーで選択インデックスを合わせる。**実際にマウスが動いたときだけ**発火する（`onMouseMove` に結線）。
   * 理由は `<button>` の `onMouseMove` のコメントを参照。
   */
  onHover: () => void;
  /** 別名エリアのクリックで別名編集に入る（ALIAS_EDIT）。 */
  onEnterAliasEdit?: () => void;
  /** 別名を永続化する（別名編集中のみ使用）。 */
  onCommitAliases?: (aliases: string[]) => Promise<void> | void;
  /** 別名編集を終了する（別名編集中のみ使用）。 */
  onCloseAliasEdit?: () => void;
  /** ダブルクリックでインライン編集に入る（INLINE_EDIT）。右クリックメニューからの実行は Popup 側で行う。 */
  onEnterInlineEdit?: () => void;
  /** インライン編集の確定内容を反映する（インライン編集中のみ使用）。 */
  onCommitEdit?: (plan: CommitPlan) => void;
  /** インライン編集を終了する（インライン編集中のみ使用）。 */
  onCancelEdit?: () => void;
  /**
   * 行の右クリック（`row-context-menu`）。ブラウザ既定のメニューは本コンポーネントが抑止し、座標を親へ渡す。
   * メニューの表示・項目の実行は Popup が担う（PANEL モードのため）。
   */
  onContextMenu?: (position: { x: number; y: number }) => void;
  /** 行のドラッグ開始候補（mousedown。5px 超で D&D 開始・U12）。編集中の行では渡さない。 */
  onDragStart?: (e: MouseEvent) => void;
  /** この行が選択中（チェック済み）か（U13）。 */
  checked?: boolean;
  /**
   * 選択モード中か（`selection-mode`）。true の間は行のクリックが「開く」ではなく「選ぶ」になり、
   * ファビコン位置に表示専用のチェックボックスが出る。行内の編集導線（別名エリア・ダブルクリック・右クリック
   * メニュー）はすべて無効化し、押下対象を「行」1つに単純化する。
   */
  selectionMode?: boolean;
  /** 行クリック（選択モード中）・Ctrl/Cmd+クリック（通常モード）で選択をトグルする（開かない）。 */
  onToggleSelect?: () => void;
  /** Shift+クリックで anchor からの範囲選択を行う（開かない・U13）。 */
  onRangeSelect?: () => void;
}

/** 別名チップの最大表示数（docs/design「結果行の共通仕様」）。超過は `+N`。 */
const MAX_CHIPS = 3;

/** ASCII のみ（ローマ字/英数字）の別名は monospace（IBM Plex Mono）で表示する（docs/design）。 */
const isAscii = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) {
      return false;
    }
  }
  return true;
};

/**
 * 検索結果の1行（56px 2段組）。docs/design「右ペイン：結果行の共通仕様」に従う。
 * 1段目=ファビコン+タイトル / 2段目（padding-left:26px）=フォルダパス+別名チップ。
 * マッチした別名（`matchedAliases`）は先頭に寄せ accent 強調する。
 *
 * 別名編集中（`editingAlias`）は行を `<button>` から `<div>` に切り替え、2段目を `AliasEditor`（状態1e）に
 * 差し替える（input を button 内に置けない・クリックで開いてしまうため）。インライン編集中
 * （`editingInline`）も同様に `<div>` へ切り替え、`InlineEdit`（状態1d）を描画する（U10）。
 */
export const ResultRow = ({
  item,
  selected,
  resultFocused = false,
  editingAlias = false,
  editingInline = false,
  dimmed = false,
  onOpen,
  onHover,
  onEnterAliasEdit,
  onCommitAliases,
  onCloseAliasEdit,
  onEnterInlineEdit,
  onCommitEdit,
  onCancelEdit,
  onContextMenu,
  onDragStart,
  checked = false,
  selectionMode = false,
  onToggleSelect,
  onRangeSelect,
}: ResultRowProps) => {
  const { t } = useI18n();
  const matched = item.matchedAliases;
  const others = item.aliases.filter(a => !matched.includes(a));
  const ordered = [...matched, ...others];
  // マッチした別名は省略対象から除外する（functional-design「マッチ別名は先頭ハイライトで省略対象外」）。
  // 最大表示数の残り枠に非マッチ別名を詰め、マッチ別名は件数超過でも必ず表示する。
  const otherSlots = Math.max(0, MAX_CHIPS - matched.length);
  const shown = [...matched, ...others.slice(0, otherSlots)];
  const extra = ordered.length - shown.length;

  // インライン編集中: 行を非ボタンのコンテナにし、InlineEdit（状態1d）を描画する。
  if (editingInline) {
    const original: EditDraft = { title: item.node.title, url: item.node.url ?? '' };
    return (
      <div className="w-full flex-none px-4 py-2">
        <InlineEdit original={original} onCommit={plan => onCommitEdit?.(plan)} onCancel={() => onCancelEdit?.()} />
      </div>
    );
  }

  // 別名編集中: 行は非ボタンのコンテナにし、1段目はテキスト、2段目を AliasEditor に差し替える。
  if (editingAlias) {
    return (
      <div className="border-line-row bg-row-selected flex min-h-14 w-full flex-none flex-col justify-center gap-[7px] border-b px-4 py-2 text-left">
        {/* 1段目（テキスト表示のまま） */}
        <span className="flex items-center gap-[10px]">
          <Favicon url={item.node.url ?? ''} />
          <span className="text-ink truncate text-[13.5px] font-medium">{item.node.title}</span>
        </span>
        {/* 2段目: 別名チップ入力（状態1e） */}
        <div className="pl-[26px]">
          <AliasEditor
            url={item.node.url ?? ''}
            initialAliases={item.aliases}
            matchedAliases={item.matchedAliases}
            onCommit={onCommitAliases ?? (() => undefined)}
            onClose={onCloseAliasEdit ?? (() => undefined)}
          />
        </div>
      </div>
    );
  }

  // 行クリックの解釈（`selection-mode`）。
  //
  // **選択モード中は行のどこを押しても「選ぶ」**（最優先の早期分岐）。行内に「開く/選ぶ」の境界を作らないため、
  // 数 px のずれで意図と違う結果になることが構造的に起きない。これが本単位の中心的な変更であり、従来の
  // 「ホバーで現れる 16×16 のチェックボックスだけが選択導線」という設計（周囲を押すとサイトが開いていた）を置き換える。
  //
  // 通常モードの分岐: 別名チップ領域（data-alias-area）→ 別名編集、Ctrl/Cmd+クリック・Shift+クリック → 選択
  // （`selectionModel` 側で選択モードへ自動遷移する）、それ以外 → 開く。ネストした interactive 要素
  // （button in button）を避けるため、単一の button 上でクリック対象により分岐する規律は維持する。
  //
  // `row-context-menu`: ホバーで現れる ✎／🗑 アイコン（data-row-action）は**廃止**した。行の右端にだけ現れる
  // 小さな押下対象で、隣を押すとサイトが開く誤操作の主因だったため。編集・削除は右クリックメニューへ移した。
  // 別名チップ領域は存置する（見えている要素そのものが押下対象で、ホバーで出入りしないため取り違えにくい）。
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (selectionMode) {
      if (e.shiftKey) {
        onRangeSelect?.();
      } else {
        onToggleSelect?.();
      }
      return;
    }
    const target = e.target as HTMLElement;
    if (e.shiftKey) {
      onRangeSelect?.();
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      onToggleSelect?.();
      return;
    }
    if (onEnterAliasEdit && target.closest('[data-alias-area]')) {
      onEnterAliasEdit();
      return;
    }
    onOpen();
  };

  // ドラッグ開始は行本体のみ。別名エリア上の mousedown は既存のクリック分岐を優先する（チップ上の微小な
  // ブレでドラッグが誤発火しないようにする）。選択モード中は別名エリアが表示のみになるため、実質
  // 「行全体がドラッグ開始点」になる。
  const handleMouseDown = (e: MouseEvent<HTMLButtonElement>) => {
    const target = e.target as HTMLElement;
    if (!selectionMode && target.closest('[data-alias-area]')) {
      return;
    }
    onDragStart?.(e);
  };

  // 右クリック（`row-context-menu`）。ブラウザ既定のメニューを抑止して独自メニューを開く。
  // 選択モード中はメニューを出さない（行操作は一括操作バーが担う。Popup 側でも `canOpenRowMenu` で防ぐ）。
  const handleContextMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (selectionMode) {
      return;
    }
    onContextMenu?.({ x: e.clientX, y: e.clientY });
  };

  return (
    <button
      type="button"
      // 選択モード中の行はトグルボタンとして振る舞うため、選択状態を支援技術へ伝える
      // （チェックボックス自体は装飾＝aria-hidden の表示専用要素）。通常モードでは押下＝遷移のため付けない。
      aria-pressed={selectionMode ? checked : undefined}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      // 選択モード中はダブルクリックでインライン編集に入らない（1回目のクリックは選択のトグルであり、
      // 2回目で編集が開くと「選んだつもりが編集画面」になる）。
      onDoubleClick={selectionMode ? undefined : onEnterInlineEdit}
      // ホバー選択は `onMouseEnter` ではなく `onMouseMove` に結線する。`↑↓` で選択が可視範囲の端に達すると
      // `ResultList` の追従 effect が `scrollTop` をずらすが、Chrome はマウスを動かしていなくても
      // 「スクロールでカーソル下の要素が変わった」時点で `mouseenter` を発火する（仮想スクロールは行を
      // `node.id` キーで再マウントするため確実に発火する）。その結果、キーボードで進めた選択が
      // 「カーソルが乗っているだけの行」に引き戻されていた。`onMouseMove` は静止したカーソルでは発火しないため、
      // 「マウスを動かしたときだけホバー選択する」という本来の意図をそのまま表現できる。
      // 同じ行の中での移動は `setSelectedIndex` が同値となり React が再レンダーを省くため、コストも増えない。
      onMouseMove={onHover}
      onMouseDown={handleMouseDown}
      title={item.node.title}
      className={cn(
        'border-line-row flex h-14 w-full flex-none flex-col justify-center gap-[5px] border-b px-4 text-left',
        // 相互アクセント（AC-14）: 右ペインがアクティブなら選択行を濃いめの accent 淡背景（強）、
        // 非アクティブなら中立グレー背景（弱）。左バーはフォーカス枠の外へはみ出して見えるため使わない。
        selected && resultFocused && 'bg-accent-bg-selected',
        selected && !resultFocused && 'bg-row-selected',
        // チェック選択中（U13）はフォーカスハイライトとは別軸で背景を付ける（design 1f）。
        // 両方成立時はフォーカスハイライト（上の分岐）を優先し、二重の背景指定を避ける。
        checked && !selected && 'bg-row-selected',
        !selected && !checked && 'hover:bg-pane-3',
        dimmed && 'opacity-40',
      )}>
      {/* 1段目 */}
      <span className="flex items-center gap-[10px]">
        {/* ファビコン / チェックボックス（`selection-mode`・デザイン1f）: 通常モードは常にファビコン、
            選択モード中は全行がチェックボックスになる（ホバーでの段階表示は誤操作の原因だったため廃止した）。
            チェックボックスは**表示専用**（pointer-events-none）で、押下は行全体が受ける。
            枠は同寸（16px）に固定し、切替でレイアウトが動かないようにする。 */}
        <span className="flex size-4 flex-none items-center justify-center">
          {selectionMode ? (
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none flex size-4 items-center justify-center rounded text-[10px] font-bold leading-none text-white',
                checked ? 'bg-accent' : 'border-line-dashed border-[1.5px] bg-white',
              )}>
              {checked && '✓'}
            </span>
          ) : (
            <Favicon url={item.node.url ?? ''} />
          )}
        </span>
        {/* `row-context-menu`: ホバーで右端に出していた ✎／🗑 アイコン（docs/design「hover: 右端に編集/削除
            アイコン」）は廃止した。編集・削除は行の右クリックメニューから行う（押下対象を行内に増やさない）。 */}
        <span className="text-ink flex-1 truncate text-[13.5px] font-medium">{item.node.title}</span>
      </span>

      {/* 2段目 */}
      <span className="flex items-center gap-2 pl-[26px]">
        {item.folderPath.length > 0 && (
          <span className="text-ink-soft flex-none truncate text-[11.5px]">{item.folderPath.join(' / ')}</span>
        )}
        {/* 別名チップ領域: この範囲のクリックは別名編集に入る（handleClick が data 属性で判定）。
            選択モード中は編集導線ではなく単なる表示にする（data 属性・ツールチップを付けない）。 */}
        <span
          data-alias-area={selectionMode ? undefined : 'true'}
          title={selectionMode ? undefined : t('popupRowAliasEdit')}
          className="flex items-center gap-2">
          {shown.map((alias, i) => {
            const isMatched = matched.includes(alias);
            return (
              <span
                key={`${alias}-${i}`}
                className={cn(
                  'flex-none rounded-full px-2 py-[2px] text-[11px] font-medium leading-[15px]',
                  isMatched
                    ? 'bg-accent text-white'
                    : // 選択中の行はチップ背景を選択行用の濃さに揃える（design 1f「チップ bg は #E4E9FB」）。
                      cn(checked ? 'bg-accent-bg-selected' : 'bg-accent-bg', 'text-accent-strong'),
                  isAscii(alias) && 'font-mono',
                )}>
                {alias}
              </span>
            );
          })}
          {extra > 0 && (
            <span className="bg-chip-muted-bg text-chip-muted-text flex-none rounded-full px-[7px] py-[2px] font-mono text-[11px]">
              +{extra}
            </span>
          )}
          {/* 別名が無い行でも編集導線を出す（別名を付けて探しやすくする）。選択モード中は押しても
              編集に入らないため出さない（押せそうに見えるものを残さない）。 */}
          {ordered.length === 0 && !selectionMode && (
            <span className="text-ink-faint border-line-dashed rounded-full border border-dashed px-2 py-[2px] text-[11px]">
              {t('popupRowAddAlias')}
            </span>
          )}
        </span>
      </span>
    </button>
  );
};
