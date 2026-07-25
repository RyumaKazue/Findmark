# Handoff: Findmark — ブックマーク検索ポップアップ（Chrome拡張）

## Overview
Findmark は「自分だけの別名（エイリアス）を付けてブックマークを探せる」Chrome拡張。
本ハンドオフは、その **ポップアップ画面（760 × 560px）** のUI設計一式である。
Spotlight / Alfred 型の検索ファーストUIで、上部ヘッダー（検索 or 一括操作バー）、左ペイン（フォルダツリー 220px 固定）、右ペイン（フォルダ横断のフラットな検索結果リスト）の3領域で構成される。

対象は **React への実装**。状態管理まで含めた仕様を本ドキュメントに記載する。

> **実装上の優先関係（本リポジトリ）**: 本ハンドオフは **ポップアップの視覚仕様（レイアウト・寸法・デザイントークン・タイポグラフィ・状態）の正**である。一方、**データモデル・別名の保存形式・検索スコア/ランキング・プライバシー方針**は、リポジトリの永続ドキュメント（`docs/architecture.md` / `docs/functional-design.md` / `docs/product-requirements.md`）と実装（`packages/storage` の AliasStore・`packages/shared` の SearchEngine）を正とする。本書の「State Management / データ取得 / スコア」節は汎用サジェストであり、以下は**採用しない**: 別名の `bookmarkId` キー保存（→ URL正規化ハッシュ）・スコア100/80…や別名を最上位（→ 実装済み SearchEngine）・別名上限8（→ 20）・外部 `https://<host>/favicon.ico`（→ `_favicon` 権限のみ・外部通信ゼロ）。詳細は `docs/functional-design.md`「UI設計 > デザイン非採用項目」。

## About the Design Files
同梱の `Findmark Popup.dc.html` は **HTMLで作られたデザインリファレンス（プロトタイプ）**であり、そのまま本番コードとして流用する前提のものではない。
狙いは、このHTMLが示す見た目・情報構造・状態遷移を、**実装先のコードベースの既存パターン（React のコンポーネント規約、スタイリング手法、UIライブラリ）で再現すること**。
まだ環境が無い場合は、Chrome拡張の popup として妥当な構成（例: Vite + React + TypeScript、MV3 の `action.default_popup`）を選定して実装してよい。

HTML内のスタイルはすべてインライン記述されている。これは「プロトタイプが即座に描画されること」を優先した都合であり、**実装ではデザイントークン化して CSS Modules / Tailwind / styled-components 等に置き換えること**を推奨する（トークン一覧は後述）。

## Fidelity
**High-fidelity (hifi)**。色・タイポグラフィ・余白・行高・角丸はすべて確定値。
ピクセル単位で忠実に再現してよい。ただし以下2点のみ暫定:

- **ファビコン**: 実画像が用意できていないため、頭文字1文字の色付きタイル（16×16, radius 4）で代替表現している。実装では実ファビコン（`chrome://favicon` / `_favicon` API または `https://<host>/favicon.ico`）を使い、**取得失敗時のフォールバックとして頭文字タイル**を使う。
- **アイコン類**: フォルダは絵文字 `📁`、開閉三角は `▸ / ▾`、チェックは `✓`、削除は `✕`、追加は `＋` の文字で表現。実装では既存アイコンセット（lucide-react 等）に差し替えることを推奨。サイズは 12〜14px、色は本文と同じ。

## 画面サイズ / ルートレイアウト

| 項目 | 値 |
|---|---|
| ポップアップ全体 | width 760px / height 560px 固定 |
| 角丸 | 12px、`overflow: hidden` |
| 影 | `0 10px 34px rgba(31,36,48,0.14), 0 1px 3px rgba(31,36,48,0.08)` |
| 構造 | `flex-direction: column` → ヘッダー（56px 固定）+ ボディ（`flex: 1`, `min-height: 0`） |
| ボディ | `flex-direction: row` → 左ペイン 220px（`flex: none`）+ 右ペイン（`flex: 1; min-width: 0; overflow: hidden`） |
| 区切り線 | 左右ペイン間 `border-right: 1px solid #E7E9EE` |
| フォント | `'Noto Sans JP', system-ui, sans-serif`（日本語・英語混在）/ 英数字ID・別名ローマ字は `'IBM Plex Mono', monospace` |

Chrome拡張の popup は最大 800×600 なので 760×560 は収まる。`html, body { margin: 0 }` 必須。

## Screens / Views

同一レイアウトの **状態バリエーション 9種**。HTML内のID（`1a`〜`1g`, `2a`, `2b`）で参照できる。

### 1a — 通常状態（検索前）
- **Purpose**: ポップアップを開いた直後。最近のブックマークを閲覧。
- **ヘッダー**: 検索ボックス（`flex: 1`, height 34, radius 6, bg `#F7F8FA`, border `1px solid #E4E7EC`, padding `0 12px`, gap 9）。左に虫眼鏡（14×14, stroke `#9AA1AE`, 幅1.6）、プレースホルダー「ブックマークを検索...」 13px / `#9AA1AE`。右に「＋ 追加」ボタン（height 34, padding `0 14px`, radius 6, bg accent, 白文字 700 12.5px）。
- **左ペイン**: 選択なし（ハイライト無し）。
- **右ペイン**: 結果行を10件フラット表示（オーバーフローは切る＝スクロール）。
- **バリエーション**: 2行（CSS Grid 完全ガイド / Figma ショートカット一覧）がファビコン取得失敗＝頭文字アバター。

### 1b — フォルダ絞り込み中
- **Purpose**: フォルダを選び、その配下で語を検索。
- **検索ボックス**: フォーカス状態（border `1.5px solid` accent + `box-shadow: 0 0 0 3px rgba(79,107,237,0.12)`, bg 白）。先頭に **フォルダ指定チップ**（pill, height 22, padding `0 8px`, bg `#EEF1FD`, text `#3D51C4` 500 11.5px, `📁` + `開発/chrome` + 右端 `✕` `#8B96C9`）。その後ろにクエリ `docs` とキャレット（1.5×16px, accent, 1.1s 点滅）。
- **左ペイン**: 親 `開発` は展開、`chrome` が **accent 塗り + 白文字 700**。
- **右ペイン**: 上部に結果メタ行（height 34, bg `#FAFBFC`, 11.5px `#6B7280`「開発 / chrome の中から「docs」— 4件」）。以下4行、パスはすべて `開発 / chrome`。**マッチした別名チップは accent 塗り + 白文字**。

### 1c — 検索中（別名でヒット）
- **Purpose**: タイトルが英語でも、自分が付けた別名（`kakuchou`）で見つかることを示す。
- **検索ボックス**: フォーカス、クエリ `kakuchou`（monospace）+ キャレット。フォルダチップなし。
- **右ペイン**: メタ行「別名でマッチ — 4件」。先頭行は **行背景 `#FAFBFF`** で最有力を示し、マッチ別名チップは accent 塗り + `box-shadow: 0 0 0 3px rgba(79,107,237,0.16)`。
- **部分一致マーカー**: チップ内の一致部分のみ強調。accent 塗りチップ内は `rgba(255,255,255,0.32)`、通常チップ内は `rgba(79,107,237,0.22)`、radius 3, padding `0 1px`。

### 1d — インライン編集中（リネーム / URL）
- **Purpose**: 行をその場でタイトル・URL・別名まで編集。
- **他要素**: ヘッダーと左ペインは `opacity: 0.45`、他の結果行は `opacity: 0.4`（dimmed）。
- **編集中の行**: 高さ可変（56px → 展開）、`padding: 14px 16px`、`box-shadow: 0 2px 10px rgba(31,36,48,0.06)`、内部 `gap: 10px` の縦積み:
  1. ファビコン + **タイトル入力**（`flex: 1`, height 34, border `1.5px` accent + focus ring, 500 13px, キャレット付き）
  2. **URL入力**（height 32, border `1px solid #E4E7EC`, bg `#FCFCFD`, monospace 12px `#444B59`, 値 `https://developer.chrome.com/docs/extensions/`）
  3. **別名チップ列**（各チップに `✕`、末尾に破線の空欄「別名を追加」= `1px dashed #C7CBD4`, radius 999, min-width 96）
  4. **アクション**（保存 = accent 塗り height 28 / キャンセル = `1px solid #E4E7EC` 灰文字 / 右にパス表示 11px `#9AA1AE`）
- インデントは常に `padding-left: 26px`（ファビコン16 + gap10）で1段目と揃える。

### 1e — 別名編集中（チップ入力）
- **Purpose**: 別名だけを追加・削除する軽い編集。
- 行の1段目はテキスト表示のまま（タイトル + パス 11.5px `#9AA1AE`）。
- 2段目が **チップ入力ボックス**: `padding: 6px 8px`, radius 8, border `1.5px` accent + focus ring, `flex-wrap: wrap`, gap 6。既存チップ3つ（各 `✕` 付き）+ 入力中テキスト `こうし` + 点滅キャレット。
- 下にヒント「Enter で確定 / Backspace で直前のチップを削除」 11px `#9AA1AE`。
- 他行は `opacity: 0.4`。

### 1f — 複数選択中（一括操作バー）
- **Purpose**: 複数ブックマークをまとめて移動 / 削除。
- **ヘッダーが差し替わる**: bg `#EEF1FD`, `border-bottom: 1px solid #DCE1F8`, `justify-content: space-between`。左に「3件選択中」 700 13px `#2E3C8F`。右に3ボタン（height 30, gap 8）:
  - 移動 = accent 塗り / 白 700 12px
  - 削除 = 白地 `1px solid #E1C4C4` / `#C0392B`
  - 選択解除 = 枠なしテキスト `#5A6480`
- **行**: ファビコン位置が **16×16 チェックボックス**（radius 4）に置換。選択済み = accent 塗り + 白 `✓`、行背景 `#F4F6FE`、チップ bg は `#E4E9FB`。未選択 = `1.5px solid #C7CBD4` の白枠。**未選択行もチェックボックスを表示**する。

### 1g — ドラッグ&ドロップ中（オプション）
- **Purpose**: 行を左ペインのフォルダへ移動。
- **ゴースト**: ポップアップを `position: relative` にし、`position: absolute; left: 172px; top: 214px`（＝カーソル追従）。width 320, `padding: 10px 14px`, radius 8, 白地 `1px solid #DCE1F8`, `box-shadow: 0 12px 26px rgba(31,36,48,0.22)`, `opacity: 0.94`, `transform: rotate(-1.5deg)`。中身はファビコン + タイトル（ellipsis）+ **件数バッジ**（min-width 20, height 20, radius 999, accent 塗り, 白 700 11px monospace, 値 `3`）。
- **ドロップ先**: 左ペインの `記事` が bg `#EEF1FD` + `1.5px dashed` accent + 700 `#2E3C8F`。
- **元の位置**: 56px の行枠内に破線プレースホルダー（`1px dashed #D3D7DE`, bg `#F4F5F8`, height 36, radius 6）、行背景 `#FAFBFC`。

### 2a — 多階層フォルダツリー（3〜4階層）
- **Purpose**: 直下フォルダだけでなく、孫・ひ孫フォルダがある場合のツリー表現。
- **ツリー構造**: 各階層は入れ子の `div`。子グループに `margin-left: 16px（第2階層は14px）; padding-left: 10px; border-left: 1px solid #E7E9EE` で **インデントガイド線**を引く。行高は 30px（最上位「すべて」のみ 32px）。
- 開閉三角は `width: 10px` の固定枠（`▾` = 展開 `#9AA1AE` / `▸` = 折りたたみ `#C2C6CF` / 子なしは空の10px枠）。
- 選択中フォルダ（`extensions`）は accent 塗り + 白 700、三角は `rgba(255,255,255,0.75)`。
- **件数バッジ**: 行右端に `10.5px monospace #9AA1AE`（「すべて」は 128、末端フォルダは 7 / 12）。
- 深い階層の名前は `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`。
- **右ペイン**: メタ行にパンくず（`開発 / chrome / extensions 配下（サブフォルダを含む）— 5件`、区切り `/` は `#C2C6CF`、末端のみ `#1F2430` 500）。行のパスは孫フォルダまで表示し、**末端フォルダ名だけ `#3D51C4`** で強調。

### 2b — 深い階層の扱い（5階層 / 省略）
- **Purpose**: 220px 幅を超える深さでも破綻しない規則を示す。
- **インデント**: 第4階層以降はガイド線のインデントを詰める（`margin-left: 8px; padding-left: 10px`）。
- **子リストの省略**: 表示は先頭2件まで、残りは「さらに 6 件…」（height 26, 11px `#9AA1AE`）。
- **ツリー下部に固定バー**: height 34, `border-top: 1px solid #E7E9EE`, bg `#F7F8FA`、「階層をたたむ ▴」。
- **パス圧縮**: 中間階層を `…` に省略（検索ボックスのフォルダチップ、右ペインのメタ行、各行のパスすべて `開発 / … / samples / mv3`）。省略記号は `#9AA1AE`。
- **規則**: パスは「先頭1階層 + … + 末尾2階層」。深さ4以下は省略しない（= 2a の表示）。

## 右ペイン：結果行の共通仕様（最重要）

```
height: 56px; flex: none;
display: flex; flex-direction: column; justify-content: center; gap: 5px;
padding: 0 16px; border-bottom: 1px solid #EFF1F4;
```

- **1段目**: `display: flex; align-items: center; gap: 10px`
  - ファビコン: 16×16, radius 4, `flex: none`
  - タイトル: 500 13.5px `#1F2430`
- **2段目**: `display: flex; align-items: center; gap: 8px; padding-left: 26px`
  - フォルダパス: 400 11.5px `#6B7280`
  - 別名チップ: `padding: 2px 8px; border-radius: 999px; background: #EEF1FD; color: #3D51C4; font-weight: 500; font-size: 11px; line-height: 15px`（日本語は Noto Sans JP、ローマ字は IBM Plex Mono）
  - 省略チップ: 最大3個表示、残りは `+2`（`padding: 2px 7px; bg #F1F2F5; color #9AA1AE; monospace`）
- **状態別の上書き**:
  - マッチ: チップ `background: accent; color: #FFFFFF`（最有力行はさらに `box-shadow: 0 0 0 3px rgba(79,107,237,0.16)`）
  - 選択: 行 `background: #F4F6FE`、チップ bg `#E4E9FB`
  - dimmed: 行 `opacity: 0.4`
  - hover（HTMLでは未表現・実装で追加）: 行 `background: #FAFBFC`、右端に編集/削除アイコンをフェードイン

**頭文字アバター（ファビコン取得失敗時）**: 16×16, radius 4, 白文字 700 9px（日本語頭文字は Noto Sans JP 9px）、中央寄せ。色は URL ホスト名のハッシュで固定割り当て。デザインで使用した色: `#2E7CF6` `#E8862B` `#2F74C0` `#1F2430` `#C0447B` `#6D5AE0` `#2B8FB8` `#4B8B3B` `#7A5AC8`。

## Interactions & Behavior

| 操作 | 挙動 |
|---|---|
| ポップアップ表示 | 検索ボックスに自動フォーカス。結果は最近のブックマーク（更新日時降順、最大 200 件を仮想スクロール推奨） |
| 文字入力 | インクリメンタル検索（debounce 120ms 目安）。タイトル・URL・別名を対象に部分一致。**別名の一致を最上位にランク付け** |
| フォルダクリック | 検索ボックス先頭にフォルダチップを挿入し、そのフォルダ **+ サブフォルダ配下**を対象に絞り込む。ツリー側もハイライト |
| フォルダチップの `✕` / チップ直後で Backspace | 絞り込み解除 |
| 三角クリック | 展開/折りたたみ（キー: `→` 展開 / `←` 折りたたみ）。展開状態は永続化 |
| `↑ ↓` | 結果行のフォーカス移動、`Enter` で開く、`⌘/Ctrl + Enter` で新規タブ |
| 行ダブルクリック / `E` | インライン編集モード（1d）へ。他行 dimmed |
| 別名エリアクリック / `A` | 別名編集モード（1e）。`Enter` 確定、`,` 区切りでも確定、`Backspace`（空入力時）で直前チップ削除、チップ `✕` で個別削除 |
| `Esc` | 編集キャンセル（変更を破棄）→ 通常表示に戻る |
| `⌘/Ctrl + S` または保存ボタン | 変更を確定 |
| 行のチェックボックス / `⌘/Ctrl + クリック` | 複数選択。1件以上でヘッダーが一括操作バー（1f）に切替 |
| `Shift + クリック` | 範囲選択 |
| 一括「移動」 | フォルダ選択メニュー → 移動。左ペインへのドラッグでも同じ |
| 一括「削除」 | 確認後に削除、「元に戻す」トーストを 5 秒表示 |
| ドラッグ開始（8px 移動で発火） | ゴースト表示（1g）。ドロップ先候補は破線ハイライト。複数選択中は件数バッジ |
| ドロップ | 移動を実行。ツリー外へのドロップはキャンセル |

**アニメーション**（すべて 120–180ms / `cubic-bezier(0.2, 0.8, 0.2, 1)`）:
- 行の展開・収縮: `height` + `opacity`
- dimmed の適用: `opacity` 150ms
- ヘッダーの検索↔一括バー切替: クロスフェード 150ms（レイアウトシフトを起こさないため高さは 56px 固定）
- キャレット点滅: `steps(1)` 1.1s infinite（実装では実 `<input>` のネイティブキャレットで足りる）

**空・エラー状態**（HTML未表現・実装で追加）:
- 結果0件: 中央に「一致するブックマークがありません」+ 「別名を付けて探しやすくする」導線
- ブックマーク0件: 「＋ 追加」への誘導
- 権限エラー: 上部にインラインバナー（`#FDF2F2` / `#C0392B`）

## State Management

Chrome拡張 popup は**開くたびにマウントし直される**ため、UI状態はローカル、永続データは `chrome.storage` に置く。

```ts
type Bookmark = {
  id: string;              // chrome.bookmarks の id
  title: string;
  url: string;
  folderId: string;
  aliases: string[];       // 拡張独自データ
  faviconUrl?: string;
  updatedAt: number;
};

type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  childIds: string[];
  count: number;           // 直下 + 配下の合計
};

type UiState = {
  query: string;
  folderFilter: string | null;        // フォルダチップ（null = 全体）
  expandedFolderIds: Set<string>;     // ツリー開閉（chrome.storage.local に永続化）
  focusedIndex: number;               // ↑↓ のフォーカス行
  selectedIds: Set<string>;           // 複数選択（1f）
  editing:
    | { kind: 'none' }
    | { kind: 'row'; id: string; draft: { title: string; url: string; aliases: string[] } }   // 1d
    | { kind: 'aliases'; id: string; draft: string[]; input: string };                        // 1e
  drag: { ids: string[]; overFolderId: string | null } | null;                                 // 1g
  status: 'loading' | 'ready' | 'error';
};
```

**派生値（stateに持たない）**
- `results` = `bookmarks` を `folderFilter`（サブフォルダ含む）+ `query` でフィルタし、スコア降順にソート
- スコア: 別名の完全一致 100 / 別名の前方一致 80 / 別名の部分一致 60 / タイトル前方一致 40 / タイトル部分一致 20 / URL部分一致 10。同点は `updatedAt` 降順
- `matchedAliasIds` = 各結果でどの別名が一致したか（チップの accent 表示に使う）
- `visibleTree` = `folders` + `expandedFolderIds` から算出。深さ5以上は子を2件で打ち切り（2b の「さらに N 件…」）
- `breadcrumb` = 深さ4以下はフル、5以上は「先頭 + … + 末尾2」に圧縮

**状態遷移（主要なもの）**

| From | Trigger | To | 副作用 |
|---|---|---|---|
| `editing.none` | 行ダブルクリック | `editing.row`（draft を現値で初期化） | 他行 dimmed、選択を解除 |
| `editing.row` | 保存 | `editing.none` | `chrome.bookmarks.update` + storage の aliases 更新（楽観更新→失敗でロールバック） |
| `editing.row` | Esc | `editing.none` | draft 破棄 |
| `editing.none` | 別名エリアクリック | `editing.aliases` | 同上 |
| `editing.aliases` | Enter | 同状態（`draft` に push, `input` を空に） | 重複・空文字は無視、最大 8 件 |
| `selectedIds.size 0 → ≥1` | チェック | ヘッダーを一括バーへ | `editing` を `none` に戻す |
| `selectedIds` | 選択解除 / Esc | `size 0` | ヘッダーを検索へ戻す |
| `drag: null` | 8px ドラッグ | `drag` 設定 | ゴースト表示 |
| `drag` | ドロップ | `null` | `chrome.bookmarks.move` を一括実行、トーストで undo |
| `query` 変更 | 入力 | — | `focusedIndex` を 0 にリセット |
| `folderFilter` 設定 | フォルダクリック | — | 祖先フォルダを自動展開 |

**データ取得**
- 起動時: `chrome.bookmarks.getTree()` → フラット化して `bookmarks` / `folders` を構築。並行して `chrome.storage.local.get('aliases')`（`{ [bookmarkId]: string[] }`）をマージ。
- 別名の書き込みは `chrome.storage.local`（同期したい場合のみ `storage.sync`、容量制限に注意）。
- `chrome.bookmarks.onChanged / onMoved / onRemoved` を購読してリストを更新。
- 300件超はメモリ内検索で十分（初期化時にインデックス構築）。1000件超なら Web Worker + 事前正規化（かな→ローマ字含む）を検討。
- 状態は `useReducer` 1つに集約（上記の遷移表がそのまま action になる）。Context で下位に配布し、副作用は `chrome.*` 呼び出しの薄いラッパー層に隔離する。

## コンポーネント分割（推奨）

| コンポーネント | 責務 | 主な props |
|---|---|---|
| `PopupShell` | 760×560 の外枠・角丸・影・3領域レイアウト | `children` |
| `SearchHeader` | 検索ボックス、フォルダチップ、「＋ 追加」 | `query`, `folderFilter`, `onQueryChange`, `onClearFolder`, `onAdd` |
| `BulkActionBar` | 一括操作バー（1f） | `count`, `onMove`, `onDelete`, `onClear` |
| `FolderTree` | 再帰ツリー、開閉、選択、ドロップ先ハイライト、深さ省略 | `folders`, `expandedIds`, `selectedId`, `dropTargetId`, `onToggle`, `onSelect` |
| `FolderTreeItem` | 1行（三角 / アイコン / 名前 / 件数）+ 子の再帰描画 | `folder`, `depth`, `state` |
| `ResultList` | 仮想スクロール、キーボードナビ、空状態 | `results`, `focusedIndex`, `selectedIds` |
| `ResultRow` | 56px 2段組、チップ、チェックボックス、dimmed | `bookmark`, `matchedAliases`, `variant: 'default' \| 'selected' \| 'dimmed' \| 'match'` |
| `RowEditor` | 1d の展開編集フォーム | `draft`, `onChange`, `onSave`, `onCancel` |
| `AliasChipInput` | 1e のチップ入力 | `aliases`, `input`, `onAdd`, `onRemove` |
| `AliasChip` | pill 1個（通常 / マッチ / 削除可 / 部分一致マーカー） | `label`, `matched`, `matchRange`, `onRemove` |
| `Favicon` | 画像 + 失敗時の頭文字タイル | `url`, `title` |
| `DragGhost` | 1g の浮遊カード | `title`, `count`, `position` |
| `Breadcrumb` | パス表示（深さに応じた省略） | `path: string[]` |

## Design Tokens

**色**

| 用途 | 値 |
|---|---|
| accent（primary） | `#4F6BED` |
| accent hover（推奨） | `#3A54C9` |
| accent 濃文字（チップ文字・選択バー文字） | `#3D51C4` / `#2E3C8F` |
| accent 薄背景（チップ・一括バー） | `#EEF1FD` / 選択行内 `#E4E9FB` |
| accent focus ring | `rgba(79,107,237,0.12)`（強調時 `0.16`） |
| 背景（面） | `#FFFFFF` |
| 背景（ペイン・入力） | `#FBFBFC` / `#F7F8FA` / `#FAFBFC` / `#FCFCFD` |
| 選択行背景 | `#F4F6FE` / 最有力行 `#FAFBFF` |
| テキスト（主） | `#1F2430` |
| テキスト（副） | `#6B7280` / `#444B59` |
| テキスト（弱） | `#9AA1AE` |
| 罫線（構造） | `#E7E9EE` / `#E4E7EC` |
| 罫線（行間） | `#EFF1F4` |
| 罫線（破線・プレースホルダー） | `#C7CBD4` / `#D3D7DE` |
| 三角（折りたたみ） | `#C2C6CF` |
| 省略チップ | bg `#F1F2F5` / text `#9AA1AE` |
| 危険（削除） | text `#C0392B` / border `#E1C4C4` |
| キャンバス（モック台紙・実装では不要） | `#E9EAEE` |

**スペーシング** 1 / 2 / 5 / 6 / 8 / 10 / 12 / 14 / 16 / 26px（26 = ファビコン16 + gap10 の視覚インデント）

**タイポグラフィ**

| 用途 | 指定 |
|---|---|
| 結果タイトル | 500 13.5px / 1 |
| フォルダ名（親） | 500 12.5px / 1 |
| フォルダ名（子） | 400 12.5px / 1（深い階層 12px） |
| 選択中フォルダ・見出し「すべて」・一括バー | 700 12.5〜13px |
| パス・メタ | 400 11.5px |
| 別名チップ | 500 11px / 15px |
| ヒント・件数 | 400 10.5〜11px |
| ボタン | 700 12〜12.5px |

**角丸** 4px（ファビコン・チェックボックス）/ 6px（ボタン・入力・ツリー行）/ 8px（チップ入力枠・ゴースト）/ 12px（ポップアップ）/ 999px（チップ）

**影** 面: `0 10px 34px rgba(31,36,48,0.14), 0 1px 3px rgba(31,36,48,0.08)` / 編集行: `0 2px 10px rgba(31,36,48,0.06)` / ドラッグゴースト: `0 12px 26px rgba(31,36,48,0.22)` / focus ring: `0 0 0 3px rgba(79,107,237,0.12)`

**固定寸法** ポップアップ 760×560 / ヘッダー 56 / 左ペイン 220 / 結果行 56 / メタ行 34 / ツリー行 30（最上位32）/ 入力 34（副 32）/ ボタン 34（一括 30, 編集 28）/ ファビコン・チェックボックス 16

## Assets
- **画像素材はゼロ**。すべて CSS と文字で構成。
- 虫眼鏡のみインライン SVG（14×14, `circle` + `line`, stroke 1.6）。
- ファビコンは実装側で取得（前述のフォールバック付き）。
- フォント: Google Fonts の **Noto Sans JP**（400/500/700）と **IBM Plex Mono**（400/500）。拡張では CDN 参照ではなく **woff2 をバンドルして `@font-face` で同梱**すること（MV3 の CSP・オフライン動作のため）。
- コピーはすべて実在感のある日本語/英語のサンプル。実装時にそのまま初期データとして使ってよい。

## Files
| ファイル | 内容 |
|---|---|
| `Findmark Popup.dc.html` | 全9状態を横並びにしたデザインリファレンス。ブラウザで直接開ける。各状態は `id="1a"`〜`id="1g"`, `id="2a"`, `id="2b"` |

HTML内は状態ごとにマークアップが独立しているため、**実装したい状態のブロックをそのまま読んで数値を拾える**。共通部分（結果行・ツリー行・チップ）は本README の共通仕様セクションを正とする。
