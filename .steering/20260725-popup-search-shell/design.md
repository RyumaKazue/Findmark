# 設計書 — U7 popup-search-shell（デザイン状態1a準拠）

## アーキテクチャ概要

`pages/popup` は UI レイヤー。ドメイン/データレイヤー（U3〜U6）を**結線するだけ**に徹し、`chrome.*` を直接触らない（[architecture.md](../../docs/architecture.md) レイヤー依存 UI→サービス→データ）。見た目は [docs/design/README.md](../../docs/design/README.md) の**状態1a**を正として忠実に再現する（760×560・確定トークン・結果行共通仕様）。検索そのものは U6 `SearchEngine.search()`（同期）に委譲する。

```
PopupShell (760×560, radius12, shadow, overflow hidden, column)
├─ SearchHeader (h56)  … 検索ボックス(h34/虫眼鏡/placeholder) + 「＋追加」(placeholder, U14)
└─ Body (flex1, row, min-h-0)
   ├─ FolderTree (w220, 表示のみ)  … getTree() のフォルダを描画・件数・開閉(ローカル)。絞り込み/永続=U11
   └─ ResultList (flex1, 仮想スクロール)
        └─ ResultRow (h56, 2段組) ── Favicon(<img> → onError で頭文字アバター)
   開く: bookmarkService.openUrl(url)   [U4 に追加]

結線: services.ts → normalizer(U3)/SearchEngine(U6)/AliasStore(U5)/bookmarkService(U4)
```

## コンポーネント設計

### 1. `services.ts`（結線モジュール・新規）
**責務**: `normalizer` 注入で `searchEngine = new SearchEngine(normalizer)` / `aliasStore = new AliasStore(normalizer)` を生成、`bookmarkService`（U4 シングルトン）を再エクスポート。Popup 全体で同一インスタンス共有（索引を持つ `SearchEngine` 使い回し）。
**要点**: ここ以外で `new SearchEngine`/`new AliasStore` を書かない（生成を1箇所へ集約）。

### 2. `hooks/useSearch.ts`（新規）
**責務**: 起動時1回 `searchEngine.loadIndex(bookmarkService, aliasStore)` → `isIndexReady`。`query` 変化に応じ `searchEngine.search({ keywords })`（同期）を実行し結果を返す。
**要点**:
- **debounce 120ms**（docs/design）でクエリを反映。フォーカスは debounce と無関係に即時（後述 SearchBox）。
- keywords = `query.trim().split(/\s+/).filter(Boolean)`。空クエリは U6 のブラウズ挙動（**タイトル昇順**。#2 の「最近順」は据え置き）。
- `folderScope` は左ペインのフォルダ選択（`folderId`）から構築する（`{ folderId, includeSubfolders: true }`）。未選択（null）なら未指定＝全件。検索ボックスへのフォルダチップ挿入・直下トグルは U11。
- 索引構築の例外は握り潰さず `console.error`（外部送信なし）。索引未構築でもフォーカスは阻害しない。
- `useMemo`（`query`/`isIndexReady` キー）で1文字あたりの再計算を抑制。

### 3. `components/PopupShell.tsx`（新規）
**責務**: 760×560 の外枠（角丸12・影・`overflow:hidden`）、ヘッダー56 + ボディ（左220 + 右 flex1・`min-h-0`）、ペイン間区切り線。
**要点**: 寸法・影・角丸は docs/design「固定寸法/影」を正とする。`children` に SearchHeader / FolderTree / ResultList を受ける。

### 4. `components/SearchHeader.tsx`（新規、SearchBox を内包）
**責務**: 検索ボックス（h34・radius6・bg `#F7F8FA`・border `#E4E7EC`・虫眼鏡SVG14・placeholder「ブックマークを検索...」13px `#9AA1AE`・フォーカス時 accent border + focus ring）と「＋追加」ボタン（h34・accent・白 700・**プレースホルダ**。onClick は U14 まで no-op + `title` 補足）。
**要点**:
- 検索 `<input>` を `useRef` + `useEffect(focus, [])` で**マウント直後**にフォーカス（200ms 要件）。`autoFocus` も併用。
- `onKeyDown` で `ArrowUp`/`ArrowDown`/`Enter` を `preventDefault` して親へ委譲（キャレット移動と競合させない）。
- 文言は日本語で仮置き（i18n は U18）。

### 5. `components/FolderTree.tsx` / `FolderTreeItem.tsx`（新規・表示＋基本の選択絞り込み）
**責務**: 左ペイン220px。`getTree()` のフォルダ階層を描画（「すべて」行 h32 + フォルダ行 h30・インデントガイド `border-left`・開閉三角 `▸/▾` 10px枠）。各行にフォルダ選択チップ（`FolderSelectChip`）を持つ。
**要点**:
- 配下件数は純粋関数 `buildFolderTree(nodes)` / `countDescendants`（テスト可能）で算出（`FolderTreeNode.count`）。**件数の数値表示は撤去し、その位置に選択チップを置く**（ユーザー指示によるデザインmockからの逸脱）。
- **開閉**は「三角＋📁＋フォルダ名」全体の押下（`onToggle`）。ローカル state（非永続）。展開永続・多階層省略は U11。
- **フォルダ選択**（`FolderSelectChip`）: 押下で `onSelectFolder(id)`。**📎クリップのアイコンボタン**で、選択状態は強調せず「押すためのボタン」に徹する（`sticky right-0` で横スクロール時も右端固定・背景でスクロール中の名前を隠す）。`Popup` の `selectedFolderId` を更新し `useSearch(query, folderId)` 経由で右ペインを配下（サブ含む）に絞り込む。再押下/「すべて」で解除（null）。検索ボックスへのチップ挿入・直下トグル・双方向同期は U11。
- **押下可能フォルダの区別**: 配下ありの親は開閉三角（濃色）＋開閉フォルダ画像（`hasChildren && expanded ? '📂' : '📁'`）＋`hover:bg-accent-bg`＋`cursor-pointer`で押下可能を明示、子なしは `text-ink-faint`・三角なしで区別。フォルダ📁/名前はやや大きめ（名前14px/📁16px/行高34px）。
- **深い階層/見切れ**: フォルダ名は省略せず（`whitespace-nowrap`）、左ペインを縦横スクロール（`overflow-auto` + 内容 `w-max min-w-full`）にして**横スライドで全表示**＋`title`（全文ツールチップ）。子リスト省略「さらにN件」・パス圧縮・「階層をたたむ」バー（状態2b）は U11。

### 6. `components/ResultList.tsx`（新規・仮想スクロール）
**責務**: 結果配列を固定行高56pxで表示、可視範囲のみ描画。
**要点**: 外部ライブラリ非追加の**自前ウィンドウング**。可視範囲計算は純粋関数 `computeWindow({ scrollTop, viewportHeight, rowHeight, count, overscan })` → `{ startIndex, endIndex, offsetY, totalHeight }`。スペーサ + `translateY(offsetY)`、overscan（例4行）。選択行が範囲外なら `scrollIntoView(block:'nearest')`。空状態（0件）を中央表示。

### 7. `components/ResultRow.tsx`（新規）
**責務**: docs/design「結果行の共通仕様」に従う56px 2段組。
**要点**:
- 1段目: Favicon(16) + タイトル（500 13.5px `#1F2430`・`truncate`・`title` 属性）。
- 2段目: `padding-left:26px`、フォルダパス（400 11.5px `#6B7280`）+ 別名チップ（pill bg `#EEF1FD` / text `#3D51C4` / 11px）。最大3個 + `+N`（省略チップ bg `#F1F2F5`）。**matchedAliases を先頭**に寄せ accent 塗り（bg accent / 白）。
- 選択ハイライト（行 bg `#F4F6FE`）。クリックで開く（jsx-a11y のため `<button type="button">` ベース）。
- 操作ボタン/チェックボックス（U10/U13）は差し込めるよう右端余白を確保（本 U7 では非表示）。

### 8. `components/Favicon.tsx`（新規）
**責務**: `<img src={faviconUrl} width/height=16>` を描画、`onError` で頭文字アバターへ切替（16×16・radius4 の固定枠でレイアウト不動）。
**要点**: `src` は `bookmarkService.faviconUrl(pageUrl,16)`（U4）。アバターの頭文字・色は純粋関数 `avatarFor(url)`（`lib/avatar.ts`）: ホスト名を FNV系ハッシュ → **docs/design の9色パレット** index、頭文字はホスト先頭英数字を大文字化（無ければ `#`）、白 700 9px 中央寄せ。

### 9. `Popup.tsx`（デモを全面置換）
**責務**: `query`/`selectedIndex` 状態を保持し、PopupShell に SearchHeader / FolderTree / ResultList を組む。↑↓ で選択移動、Enter/クリックで `bookmarkService.openUrl(node.url)`（空URLはガード）。結果変化時に `selectedIndex` をクランプ。
**要点**: U8 の本格モード状態機械は導入せず、LIST 相当の最小挙動のみをローカル state で（U8 で `useMode` に巻き取れる粒度）。`withErrorBoundary(..., ErrorDisplay)` を保持し、`exampleThemeStorage`/`injectContentScript`/ロゴは削除。

### 10. `BookmarkService.openUrl(url)`（U4 への最小追加）
**責務**: アクティブタブで URL を開く（UC-1）。`chrome.tabs.update({ url })` の薄いラッパ。UI から `chrome.tabs` を直接呼ばせないため tabs ラッパである BookmarkService に追加。U4 の既存挙動は不変。`bookmarkService.test.ts` にテスト1件追加。

### 11. デザイントークン / フォント基盤
- **トークン**: `pages/popup/tailwind.config.ts` の `theme.extend` に docs/design「Design Tokens」を写す（accent `#4F6BED`・背景/罫線/テキスト色・スペーシング 26 等・角丸 4/6/8/12/999・影）。将来 `packages/ui` へ昇格可。厳密な hex は CSS 変数併用も可。
- **フォント**: 依存に `@fontsource/noto-sans-jp`・`@fontsource/ibm-plex-mono` を追加。`index.tsx`（または `index.css`）で必要ウエイト（NotoSansJP 400/500/700 / IBMPlexMono 400/500）を import → Vite が woff2 を同梱（CDN不使用）。base で本文=Noto Sans JP、monospace 箇所=IBM Plex Mono を適用。
  - **バンドルサイズ注記**: Noto Sans JP は日本語グリフを含むため woff2 が数MB規模になりうる。architecture の「Popup gzip 300KB」目安は JS バンドル向けであり、フォントは別資産として扱う（デザイン忠実度を優先。ユーザー承認済み）。

## データフロー（UC-1）
```
1. Popup マウント → SearchHeader の <input> が即フォーカス（読み込みを待たない）
2. useSearch が loadIndex(...) 実行 → isIndexReady=true
3. 入力 → debounce120ms → query 反映 → search({ keywords }) 同期 → SearchResultItem[]
4. ResultList が可視範囲のみ描画（各行 Favicon 付き）
5. ↑↓ で selectedIndex 移動 / Enter・クリック → bookmarkService.openUrl(url)
```

## エラーハンドリング戦略
- 新規カスタムエラーなし（表示基盤・破壊的操作なし）。
- `loadIndex`/`search` 例外は `console.error`、UI は落とさない（`withErrorBoundary` を保険に）。空結果扱い。
- `openUrl` 失敗は `console.error`（ロールバック不要）。URL 空のブックマークは開かない（ガード）。
- 外部通信ゼロ厳守（`fetch`/XHR/WebSocket なし。ファビコンは `_favicon`、フォントは同梱 woff2 で外部通信なし）。

## テスト戦略
> UI 主要導線は E2E 担当（architecture テスト戦略）。U7 は **React 非依存の純粋ロジックのみ**を vitest（node環境・jsdom不要）でテスト。コンポーネント/フックの結線・見た目は目視 + 後続 E2E。

### ユニットテスト
- `lib/avatar.ts` `avatarFor(url)`: 同一ドメイン同色 / 異ドメイン分散 / 頭文字大文字化 / 不正URL・ホスト無しで `#` / 色が9色パレット内。
- `components/virtualization.ts` `computeWindow(...)`: スクロール位置別の範囲・offsetY・totalHeight・overscan・境界（先頭/末尾/0件）。
- `components/folderTree.ts`（純粋部）`buildFolderTree`/`countDescendants`: 階層構築・配下件数（直下+サブ）・フォルダのみ抽出。
- `packages/storage` `bookmarkService.openUrl`: `chrome.tabs.update({ url })` 呼び出しを検証（既存 chrome モック方式）。

### 統合テスト
- U7 では自動統合テストは追加しない（結線は E2E スコープ）。

## 依存ライブラリ
新規実行時依存: **フォント**（@fontsource）。仮想スクロール・あいまい検索は自前。popup のテスト用 devDependency に `vitest`。

```json
{
  "dependencies": {
    "@fontsource/noto-sans-jp": "^5",
    "@fontsource/ibm-plex-mono": "^5"
  },
  "devDependencies": {
    "vitest": "^4.1.10"
  }
}
```

## ディレクトリ構造
```
pages/popup/
├── package.json                 # @fontsource/* 依存, vitest devDep, "test": "vitest run"
├── tailwind.config.ts           # theme.extend にデザイントークン
├── vitest.config.ts             # 新規（node 環境）
└── src/
    ├── Popup.tsx                # 全面置換（検索シェルのルート）
    ├── index.tsx                # フォント import 追加
    ├── index.css / Popup.css    # 760×560・base フォント・トークン適用
    ├── services.ts              # 結線
    ├── hooks/useSearch.ts
    ├── components/
    │   ├── PopupShell.tsx
    │   ├── SearchHeader.tsx
    │   ├── FolderTree.tsx / FolderTreeItem.tsx
    │   ├── folderTree.ts / folderTree.test.ts        # 純粋部
    │   ├── ResultList.tsx
    │   ├── ResultRow.tsx
    │   ├── Favicon.tsx
    │   ├── virtualization.ts / virtualization.test.ts
    │   └── (将来: BulkActionBar/RowEditor/AliasChip… 後続単位)
    └── lib/avatar.ts / lib/avatar.test.ts

packages/storage/lib/impl/
├── bookmarkService.ts           # openUrl 追加
└── bookmarkService.test.ts      # openUrl テスト
```

## 実装の順序
1. `BookmarkService.openUrl`（テスト込）。
2. デザイントークン（tailwind.config）＋フォント同梱（@fontsource import）＋ base 適用。
3. 純粋ロジック（avatar / virtualization / folderTree）＋テスト。
4. popup に vitest 導入。
5. `services.ts` → `hooks/useSearch.ts`。
6. 表示コンポーネント（Favicon → ResultRow → ResultList → FolderTree → SearchHeader → PopupShell）。
7. `Popup.tsx` 置換 ＋ `index.css`/`Popup.css`（760×560）。
8. 品質チェック（test/lint/type-check）＋ `pnpm dev` で 1a と目視照合。

## セキュリティ考慮事項
- 外部通信ゼロ厳守（フォントは同梱 woff2、ファビコンは `_favicon`）。CDN 参照なし。
- UI から `chrome.*` を直接呼ばない（`openUrl` もデータ層経由）。
- 開く URL は既存ブックマークの `node.url`（Chrome 管理済み）のみ。空 URL はガード。ユーザー入力 URL の検証は U10。

## パフォーマンス考慮事項
- 即フォーカス（`loadIndex` 完了に依存させない）。
- 同期検索 + debounce120ms + `useMemo` で入力ごとのコスト最小化。
- 仮想スクロールで描画コストを表示行数に固定。
- フォントは woff2 別資産（JS バンドルを膨らませない）。初回表示の FOUT は許容（同梱のため即時ロード）。

## 将来の拡張性
- `Popup.tsx` のローカル選択 state は U8 の `useMode` に巻き取れる粒度。
- `useSearch` の `SearchQuery.folderScope` の口を残し U11 が最小改修で接続。
- `FolderTree` は U11 で絞り込み・展開永続・多階層省略を追加。`ResultRow` は U10/U13 の操作ボタン・チェックボックスを差し込める余白を確保。
- デザイントークンは将来 `packages/ui` へ昇格し Options でも共有。
