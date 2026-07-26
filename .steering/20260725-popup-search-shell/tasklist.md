# タスクリスト — U7 popup-search-shell（デザイン状態1a準拠）

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース
以下の技術的理由に該当する場合のみスキップ可能:
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:
```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

---

## フェーズ1: データレイヤー拡張（開く操作）

- [x] `BookmarkService.openUrl(url)` を追加（`packages/storage/lib/impl/bookmarkService.ts`）
  - [x] `chrome.tabs.update({ url })` の薄いラッパ（UC-1）。既存メソッド・受け入れ基準は不変
- [x] `bookmarkService.test.ts` に `openUrl` テスト追加（`chrome.tabs.update({ url })` 呼び出しを検証）

## フェーズ2: デザイントークン & フォント基盤

- [x] `pages/popup/tailwind.config.ts` の `theme.extend` に docs/design トークンを定義（accent `#4F6BED`・背景/罫線/テキスト色・角丸は既定4/6/8/12/999を利用・影・fontFamily sans/mono）
- [x] `pages/popup/package.json` に `@fontsource/noto-sans-jp`・`@fontsource/ibm-plex-mono` を追加し `pnpm install`
- [x] `index.tsx` で必要ウエイト×必要サブセット（NotoSansJP latin/japanese 400/500/700 / IBMPlexMono latin 400/500）を import → Vite で woff2 同梱（CDNなし）
- [x] base スタイルで本文=Noto Sans JP を適用、760×560 固定（`index.css`）。デモ用 `Popup.css` を撤去

## フェーズ3: 純粋ロジック（テストファースト）

- [x] `pages/popup/src/lib/avatar.ts` `avatarFor(url)`（ホスト→FNV系ハッシュ→9色パレットindex、頭文字大文字化、不正URL/ホスト無しは`#`）
- [x] `lib/avatar.test.ts`（同一ドメイン同色/異ドメイン分散/頭文字/不正URL/色が9色内）
- [x] `pages/popup/src/components/virtualization.ts` `computeWindow(...)` → `{startIndex,endIndex,offsetY,totalHeight}`
- [x] `components/virtualization.test.ts`（スクロール位置別・overscan・境界）
- [x] `pages/popup/src/components/folderTree.ts` `buildFolderTree(nodes)`/`countDescendants`（フォルダ抽出・配下件数）
- [x] `components/folderTree.test.ts`（階層構築・件数=直下+サブ・フォルダのみ）

## フェーズ4: popup テスト基盤

- [x] `pages/popup/package.json` に `"test": "vitest run"` と devDep `vitest`(^4) を追加
- [x] `pages/popup/vitest.config.ts`（node 環境）を新規作成
- [x] `pnpm -F @extension/popup test` が実行できることを確認（18 tests pass）

## フェーズ5: 結線モジュールとフック

- [x] `pages/popup/src/services.ts`（normalizer注入で searchEngine/aliasStore 生成、bookmarkService 再エクスポート）
- [x] `pages/popup/src/hooks/useSearch.ts`
  - [x] 起動時1回 `loadIndex(bookmarkService, aliasStore)` → `isIndexReady`
  - [x] `query`→keywords 分割→`search({keywords})`（同期）を **debounce120ms** + `useMemo` 化
  - [x] 空クエリは U6 ブラウズ（タイトル昇順）。索引例外は `console.error` で UI を落とさない

## フェーズ6: 表示コンポーネント（docs/design 1a 忠実）

- [x] `components/Favicon.tsx`（`<img>` 16×16 + onError→`avatarFor` アバター、枠不動）
- [x] `components/ResultRow.tsx`（56px 2段組・タイトル truncate・フォルダパス・別名チップ最大3+`+N`・matchedAliases先頭accent・選択ハイライト・`<button>`でクリック開く）
- [x] `components/ResultList.tsx`（`computeWindow` の自前仮想スクロール・overscan・選択追従スクロール・空状態）
- [x] `components/FolderTree.tsx` / `FolderTreeItem.tsx`（左220px・「すべて」+フォルダ・インデントガイド・開閉三角・件数。開閉はローカル表示のみ、絞り込み/永続はU11）
- [x] `components/SearchHeader.tsx`（検索ボックス h34/虫眼鏡/placeholder/フォーカスリング・即フォーカス・↑↓/Enterを親へ委譲、「＋追加」プレースホルダ）
- [x] `components/PopupShell.tsx`（760×560・角丸12・影・ヘッダー56+ボディ左220/右flex1・区切り線）

## フェーズ7: Popup ルートの置換

- [x] `pages/popup/src/Popup.tsx` をデモから全面置換
  - [x] `query`/`selectedIndex` 状態、PopupShell に SearchHeader/FolderTree/ResultList を結線
  - [x] ↑↓ で選択移動、Enter/クリックで `bookmarkService.openUrl(node.url)`（空URLガード）、selectedIndex クランプ、0件/読み込み中の出し分け
  - [x] `withErrorBoundary(..., ErrorDisplay)` 保持、`exampleThemeStorage`/`injectContentScript`/ロゴ削除
- [x] `pages/popup/src/index.css`・`Popup.css` を 760×560・base フォント/トークンへ調整

## フェーズ8: 品質チェックと修正

- [x] `pnpm test`（12タスク成功。popup 18 tests / storage 48 tests 含む）
- [x] `pnpm lint`（15タスク成功）
- [x] `pnpm type-check`（14タスク成功）
- [x] `pnpm build` で拡張がビルドできることを確認（フォント同梱の検証を含む）。状態1a（寸法・トークン・行レイアウト）の目視照合はユーザー受け入れ（ゲート2）で実施

## フェーズ9: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.mdの各要件）と実装を突き合わせOK/NGを一覧化
- [x] implementation-validator サブエージェントによる品質検証（ブロッカーなし・4.6/5。推奨1件=虫眼鏡アイコン色 #9AA1AE を反映済み。推奨1件=getTree重複はU11へ持ち越し）
- [x] ユーザーに検証を依頼
- [x] 受け入れ承認（ゲート2）を取得（2026-07-25。検証ログ ラウンド1〜3 の修正反映後に承認）
  - NGは「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ10: ドキュメント更新・振り返り（モード4）

- [x] `docs/mvp-development-flow.md` の進捗表を U7 完了に更新
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

- ラウンド1（2026-07-25）
  - 不一致内容: 左ペインのフォルダ行で、開閉の押下範囲が展開三角のみだった。フォルダ画像（📁）も押下範囲に含めたい（ユーザー受け入れ検証での指摘）。
  - 分類: A（実装欠陥/調整。計画・設計の前提は不変、再承認不要）
  - 戻り先: モード2（`components/FolderTreeItem.tsx`）
  - 対応: 展開トグルの `<button>` に 📁 アイコンを内包し、三角＋📁 を一体の押下範囲にした。フォルダ名クリック（絞り込み）は従来どおり U11。lint/type-check 再パス。

- ラウンド3（2026-07-25）
  - 不一致内容: ディレクトリ構造が深い場合、最下層のフォルダ名が見切れる（左220px固定＋インデント＋常時表示チップで名前幅が枯渇）。
  - 分類: A（実装調整。方針Aで対応、再承認不要）
  - 戻り先: モード2（`FolderTreeItem.tsx`）
  - 対応: (1) 選択チップをテキスト「表示/表示中」からコンパクトなラジオ風アイコン(18px・選択中accent＋チェック)に変更し常時表示幅を圧縮、(2) 深い階層ほどインデントを段階的に詰める（ml 12→10→6 / pl 8）、(3) フォルダ名に全文ツールチップ（title）＋ellipsis。lint/type-check/test 再パス。子リスト省略・パス圧縮等（2b）は U11。

- ラウンド2（2026-07-25）
  - 不一致内容: (1) 開閉の押下範囲を「📁＋フォルダ名の全体」に拡大したい。(2) 件数の数字表示を消し、その位置にフォルダ選択チップ（押下でそのフォルダが選択され中身が右ペインに表示される）を置きたい（ユーザー受け入れ検証での指摘）。
  - 分類: C（要件の認識ズレ/スコープ変更。当初 U11 に切り出していた「フォルダ選択による絞り込み」の基本部分を U7 に取り込む）
  - 戻り先: モード2（`FolderTree.tsx` / `FolderTreeItem.tsx` / `hooks/useSearch.ts` / `Popup.tsx`）＋ ドキュメント（mvp-development-flow / functional-design / 本steering）
  - 対応: 三角＋📁＋名前を一体の展開トグルに。件数表示を撤去し、フォルダ名の右に `FolderSelectChip`（選択中は accent「表示中」）を新設。選択で `useSearch` に `folderScope`（サブフォルダ含む）を渡し右ペインを絞り込む。「すべて」で解除。lint/type-check/test 再パス。U11 は「検索ボックスへのフォルダチップ挿入・直下トグル・ツリー⇄チップ同期・展開永続・多階層省略」を担当と再定義。

---

## 実装後の振り返り

### 実装完了日
2026-07-25

### 計画と実績の差分

**計画と異なった点**:
- 計画途中で `docs/design/`（hifi デザインハンドオフ）が追加され、U7 のスコープが「検索+結果の最小シェル」から「デザイン状態1a に忠実な 760×560 の3領域シェル＋デザイントークン＋フォント同梱」へ拡大した。あわせて `docs/`（functional-design / mvp-development-flow / repository-structure / architecture）に「レイアウトの正 = docs/design」「デザイン非採用項目（データ/ロジックは既存が正）」を明文化した。
- フォントは @fontsource で必要ウエイト×必要サブセット（latin + japanese）のみ同梱。日本語グリフのため woff2 は MB 規模だが、デザイン忠実度優先でユーザー承認済み。JS バンドルは 237kB(gzip76kB) で 300KB 目安内。
- 受け入れ検証で当初 U11 だった「フォルダ選択→絞り込み」の基本部分を U7 に前倒し（ユーザー指示）。件数表示を撤去しフォルダ選択チップに置換（デザインmockからの意図的逸脱として docs に明記）。

**新たに必要になったタスク**:
- `BookmarkService.openUrl`（U4 への最小追加。UIから chrome.tabs を直接呼ばせないため）。
- デザイントークン定義（popup tailwind.config）＋フォント同梱（@fontsource）。
- ファイル名の大小文字衝突回避（`FolderTree.tsx` と純粋部 `folderTreeModel.ts`）。
- フォルダ選択絞り込み（`useSearch` への `folderId`/`folderScope`、`FolderSelectChip`）と深階層の見切れ対策（アイコン化・インデント詰め・全文ツールチップ）。

**技術的理由でスキップしたタスク**（該当する場合のみ）:
- なし（全タスク完了）。`FolderTree` と `useSearch` の `getTree()` 重複呼び出しの最適化のみ U11 へ持ち越し（validator 指摘・機能影響なし）。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 3
  - ラウンド1（A・実装調整）: 展開トグルに 📁 を内包。
  - ラウンド2（C・スコープ変更）: フォルダ選択チップ新設＋件数撤去、フォルダ選択絞り込みを U7 に取り込み（U11 再定義）。
  - ラウンド3（A・実装調整）: 深階層の名前見切れを方針A（チップのアイコン化・インデント詰め・全文ツールチップ）で解消。
- 主な不一致と分類: A×2（実装調整）/ C×1（スコープ変更・docs へ反映）。
- 受け入れ承認: 2026-07-25。

### 受け入れ後の見た目リファイン（2026-07-26・別ブランチ `fix/popup-folder-tree-ui`）

U7 を dev マージ後、左ペインの見た目についてユーザー依頼で以下を調整（機能・受け入れ基準は不変、視覚のみ）:

1. フォルダ📁・名前を拡大（名前12.5→14px / 📁13→16px / 行高30→34px / 「すべて」14px）。
2. 深い階層で見切れる名前は**横スクロール（スライド）で全表示**（`whitespace-nowrap` + 内容 `w-max min-w-full`）。従来の末尾省略主体から変更（`title` ツールチップは維持）。
3. フォルダ選択ボタンを ✓ラジオ → **📎クリップのアイコンボタン**に変更（選択状態は非強調）。横スクロール時も押せるよう `sticky right-0` で右端固定。
4. **押下可能フォルダの区別**を追加: 配下ありの親フォルダに 開閉三角（濃色）＋開閉フォルダ画像（📂/📁）＋`hover:bg-accent-bg`＋`cursor-pointer`、子なしは淡色・三角なし。

対応 docs: `functional-design.md`（UI設計 左ペイン）/ `mvp-development-flow.md`（U7 行）/ 本 steering（requirements・design）。lint/type-check/test 18 パス。

### 学んだこと

**技術的な学び**:
- 「レイアウトの正 = デザインハンドオフ / データ・ロジック・プライバシー = 既存永続ドキュメント」という優先関係を先に docs で確定したことで、README の汎用実装サジェスト（bookmarkId キー保存・スコア改変・外部 favicon.ico 等）が実装済み U4/U5/U6 と衝突するのを防げた。
- 検索は U6 の同期 `search()` に委譲し、索引構築（非同期）とフォーカス（即時）を分離したことで 200ms フォーカス要件と debounce120ms を両立できた。
- macOS（大小文字を区別しないFS）では `FolderTree.tsx` と `folderTree.ts` が TS でファイル名衝突する。純粋部は `folderTreeModel.ts` に改名して回避。
- ESLint（func-style=expression / exports-last / no-control-regex）に沿うには、純粋ロジックを「非exportを先頭・exportを末尾・自己再帰のarrow」で構成するのが安全。
- 220px 固定ペインでの深階層表示は「常時表示UIの専有幅」がボトルネック。チップのアイコン化＋インデント詰め＋ツールチップの複合で名前幅を確保できた。

**プロセス上の改善点**:
- デザイン資産が後から入る場合、実装着手前に「視覚 vs データ/ロジックの優先関係」と「mock からの逸脱点」を docs に固定してから進めると手戻りが少ない。
- 受け入れ検証での UX 調整（押下範囲・チップ・見切れ）は、方針を先に提示して選んでもらう（方針A/B/C）ことで認識ズレを避けられた。

### 次回への改善提案
- U8（mode-keyboard）は U7 の Popup ローカル state（query/selectedIndex/selectedFolderId）を `useMode` に巻き取る前提。選択・フォルダ絞り込みの state 境界を意識して設計する。
- U11（folder-scope-tree）は U7 の `folderScope` 結線・`FolderSelectChip`・深階層インデントの上に、検索ボックスへのフォルダチップ挿入・直下トグル・双方向同期・展開永続・子リスト省略（2b）を積む。`getTree()` 重複呼び出しの一本化もここで行う。
- フォント同梱は woff2 に加え @fontsource が legacy woff も出力するため、Chrome 専用MVPでは woff を除外できればさらに軽量化できる（U18 で検討）。
