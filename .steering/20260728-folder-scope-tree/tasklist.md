# タスクリスト: U11 folder-scope-tree

- **作業単位ID / 名**: U11 / `folder-scope-tree`
- **作成日**: 2026-07-28
- **前提**: [requirements.md](./requirements.md) / [design.md](./design.md)

---

## フェーズ1: データレイヤー（展開状態の永続）

- [x] T1-1: `packages/storage/lib/types.ts` の `LocalState` に `isExpandedInitialized?: boolean` を追加する（JSDoc で「空配列だけでは初回と全折りたたみを区別できない」理由を記す）
- [x] T1-2: `packages/storage/lib/impl/localStateStore.ts` に `expandFolders(ids)` / `initializeExpanded(ids)` を追加し、`toggleExpanded` でも `isExpandedInitialized` を立てる
- [x] T1-3: `packages/storage/lib/impl/stores.test.ts` に T1-2 のテストを追加する（初回のみ書き込む / 2回目は何もしない / 既存 ID を重複させない）

## フェーズ2: 純粋ロジック（ツリーモデル・メタ行）

- [x] T2-1: `folderTreeModel.ts` に `TreeRow` 型と `rowKey` を追加する
- [x] T2-2: `folderTreeModel.ts` に `flattenVisibleTree`（展開状態 + 深さ省略 2b・先頭に「すべて」行）を実装する
- [x] T2-3: `folderTreeModel.ts` に `moveRow` / `findParentId` / `collectAncestorIds` / `findFolderPath` を実装する
- [x] T2-4: `folderTreeModel.ts` に `compressPath` / `formatPath`（design 2b の圧縮規則）を実装する
- [x] T2-5: `folderTreeModel.test.ts` に T2-1〜T2-4 のテストを追加する（可視行の並び / 折りたたみで子が消える / 深さ5で 2件+more / 端での移動が null / 祖先収集 / `/` 含みのパス / 深さ4以下は圧縮しない）
- [x] T2-6: `resultMetaModel.ts`（新規）に `buildResultMetaLabel` を実装する
- [x] T2-7: `resultMetaModel.test.ts`（新規）に 4条件（query×scope の有無）のテストを追加する

## フェーズ3: 左ペイン UI の再設計

- [x] T3-1: `FolderTreeItem.tsx` から `FolderSelectChip`（📎）を削除する
- [x] T3-2: `FolderTreeItem.tsx` に chevron の展開トグルボタン（20×20・hover 背景・`aria-expanded`）を実装する（子なしは同寸の空枠）
- [x] T3-3: `FolderTreeItem.tsx` の「📁 フォルダ名」をスコープ選択ボタンにする（子なしでも押下可・スコープ中は accent 塗り + 白文字・`aria-current`）
- [x] T3-4: `FolderTreeItem.tsx` に「さらに N 件…」行（`kind: 'more'`）を実装する（フォーカス中の薄い背景・クリックで残りを表示）
- [x] T3-5: `FolderTreeItem.tsx` のインデント/ガイド線を design 2a/2b に合わせる（第4階層以降は詰める）
- [x] T3-6: 行内ボタンに `onMouseDown` の `preventDefault` を入れ、クリック時はツリールートへ DOM フォーカスを戻す

## フェーズ4: `FolderTree` の状態管理

- [x] T4-1: `FolderTree.tsx` を `TreeRow` ベースの描画へ書き換える（`flattenVisibleTree` の結果を再帰ではなくフラットに描画するか、再帰構造を維持しつつ同じ省略規則を適用するかを実装時に決める）
- [x] T4-2: `localStateStore` から展開状態を読み込み、初回は最上位フォルダを `initializeExpanded` で書き込む
- [x] T4-3: 展開トグルを `localStateStore.toggleExpanded` で永続化する
- [x] T4-4: スコープ変更時に `collectAncestorIds` で祖先を自動展開し `expandFolders` で永続化する
- [x] T4-5: ルート `div` に `tabIndex={-1}` を置き、`focused` が真になったら `focus()` する
- [x] T4-6: スコープ行が可視範囲外なら `scrollIntoView({ block: 'nearest' })` で追従する
- [x] T4-7: `FolderTreeActions`（`moveFocus`/`focusParent`/`toggleExpand`/`focusAll`）を `actionsRef` 経由で公開する
- [x] T4-8: `onFoldersLoaded` で取得したフォルダツリーを親へ渡す

## フェーズ5: ヘッダー・右ペインの可視化

- [x] T5-1: `SearchHeader.tsx` の起動時 `inputRef.current?.focus()` を削除する（既定フォーカスは左ペイン）
- [x] T5-2: `SearchHeader.tsx` に表示専用フォルダチップ（`📁` + 圧縮パス・`✕` なし）を追加する
- [x] T5-3: `ResultList.tsx` に `metaLabel` を追加し、34px のメタ行をスクロールコンテナ外の上部に描く

## フェーズ6: `Popup` の結線

- [x] T6-1: `useMode.ts` を `useMode(initialMode: Mode = 'LIST')` に変更する
- [x] T6-2: `Popup.tsx` の `selectedFolderId` を `scopeFolderId` に改称する
- [x] T6-3: `Popup.tsx` で `useMode('FOLDER_TREE')` にして起動時の既定フォーカスを左ペインへ変更する（JSDoc の暫定記述も更新）
- [x] T6-4: `folder:move-up` / `move-down` / `parent` / `toggle-expand` / `home` を `folderTreeActions` へ結線する
- [x] T6-5: `folders` から `scopePath` を算出し、`SearchHeader`（チップ）と `ResultList`（メタ行）へ渡す

## フェーズ7: 検証・ドキュメント

- [x] T7-1: `implementation-validator` サブエージェントで品質検証する
- [x] T7-2: `pnpm test` / `pnpm lint` / `pnpm type-check` をフォアグラウンドで実行し exit code 0 を確認する
- [x] T7-3: `docs/functional-design.md`「デザイン非採用項目」に #10（チップの `✕` を出さない）・#11（「階層をたたむ」バーを実装しない）を追記する
- [x] T7-4: 受け入れ基準 AC-1〜AC-13 を実装と突き合わせ、OK/NG 一覧を作る（ゲート2 提示用）

---

## フェーズ8: アクティブペインの視覚的区別（AC-14・ユーザー指摘対応）

- [x] T8-1: `FolderTreeItem.tsx` に `paneFocused` を追加し、スコープ強調を「アクティブ=accent塗り+白 / 非アクティブ=accent淡背景+accent文字」に出し分ける（chevron 色も追従）
- [x] T8-2: `FolderTree.tsx` から `paneFocused={focused}` を各行へ渡し、ルートにアクティブ時の inset ring を付ける
- [x] T8-3: `ResultRow.tsx` に `resultFocused` を追加し、選択行を「アクティブ=accent淡背景+accent左バー / 非アクティブ=中立グレー」に出し分ける（レイアウトシフトしない inset 方式）
- [x] T8-4: `ResultList.tsx` に `resultFocused` を追加し各行へ渡す＋アクティブ時にリスト領域へ inset ring
- [x] T8-5: `Popup.tsx` で `currentFocusArea` から `resultFocused` を導出して `ResultList` へ渡し、左右ペイン枠を対称に適用する
- [x] T8-6: 再ゲート（`type-check`/`lint`/`test` をフォアグラウンドで exit 0 確認）

## 検証ログ

### ラウンド1（implementation-validator・2026-07-28）

総合 4.2/5。純粋ロジック分離・レイヤー遵守・AC-8（マウス/キーボード一致）・深さ省略テストを高評価。検出:

- **[必須・分類A 実装欠陥]** `focusedMoreParentId` が Escape の `clear-scope`（スコープ外部クリア）で同期されず、「さらに N 件…」行フォーカス中にスコープが外部から消えると内部フォーカス基準が古い more 行のまま固定化 → `↑↓` が無反応/予測不能（AC-1/AC-2 違反・U19 でも再発）。
  → **対応済み**: `FolderTree.tsx` に `useEffect(() => setFocusedMoreParentId(null), [scopeFolderId])` を追加（more 行移動時は scope 不変のため誤打ち消しなし）。
- **[推奨]** `formatPath` が本番未使用でパス結合が3箇所に重複。
  → **対応済み**: `SearchHeader.tsx` / `resultMetaModel.ts` を `formatPath` 利用へ統一。
- **[推奨]** `registerRef` がレンダー毎に再生成され ref が不要着脱。
  → **対応済み**: 行キーごとに ref コールバックをキャッシュし identity を安定化。
- **[提案]** `FolderTree` の state 同期に対する結合テスト（testing-library）。
  → **見送り**（プロジェクト方針: React コンポーネント自体のテストは持たず純粋ロジックのみ。申し送りへ記録）。

修正後の再ゲート（フォアグラウンド・exit code 確認）: `type-check` 0 / `lint` 0 / `test` 0（popup 107・storage 53 件パス）。

### ラウンド2（ゲート2 ユーザー指摘・分類C 要件追加・2026-07-28）

「フォルダ/リストのどちらにフォーカスがあるか感覚的に分からない」との指摘。AC に「アクティブペインの視覚的区別」が無かった認識ズレ（分類C）として **AC-14 を追加**し、方式をユーザー選択（**濃淡＋ペイン枠**）で確定→フェーズ8として実装。

- 相互アクセント: アクティブ側のスコープ/選択を accent 濃色、非アクティブ側を淡色に出し分け（左=フォルダ塗り強弱・右=選択行の accent 左バー/中立グレー）。
- ペイン枠: `toFocusArea` が `folderTree`/`result` のとき当該ペインへクリップされない inset ring を対称適用。
- 検索ボックスアクティブ時は両ペイン弱表示（検索ボックス自身の focus ring で位置提示）。
- 再ゲート（フォアグラウンド・exit code 確認）: `type-check` 14 / `lint` 15 / `test` 12 すべて 0。

### ラウンド3（ゲート2 ユーザー指摘・AC-14 見た目調整・2026-07-28）

実機スクショで2点の指摘。いずれも「フォーカス枠は一番外側にあるべき」という原則:

- **枠が細く・見切れる**（初回）→ ペイン端の inset ring がヘッダー下/角丸でクリップ。→ フル濃度 accent 2px のオーバーレイ枠へ変更。
- **選択行の左バー・フォルダ塗りが枠の外にはみ出す**（2回目）→ 枠を `inset-1`（4px内側）に置いたため中身が枠外に。→ **枠を最外周 `inset-0` へ移動**し、下角のみ `rounded-bl-xl`/`rounded-br-xl` でポップアップ角丸に整合。**選択行の accent 左バーを廃止**し、アクティブ選択は濃いめ accent 淡背景（`#E4E9FB`）で表現（枠内に収まる）。
- 再ゲート（フォアグラウンド・exit code 確認）: popup `type-check`/`lint`/`test` すべて 0（107件）。

---

## 申し送り事項

**実装完了日**: 2026-08-07（ゲート2 受け入れ承認）

**計画と実績の差分**:
- 当初の受け入れ基準は AC-1〜AC-13。ゲート2 のユーザー指摘で **AC-14「アクティブペインの視覚的区別（相互アクセント + 最外周フォーカス枠）」を追加**（フェーズ8）。
- FolderTree 描画は design.md で「再帰 or フラット」を実装時判断としていたが、キーボード移動・スクロール追従・DOMフォーカスとの1:1対応を優先し**フラット描画**（`flattenVisibleTree` の行配列を直接 map）を採用。

**学んだこと / 次回への改善提案**:
- **品質ゲートは必ずフォアグラウンドで exit code を確認**（turbo の TUI をバックグラウンド実行すると exit 0 を誤報告し、実際は popup lint が失敗していた）。[[turbo-gate-foreground]]
- `scopeFolderId` と `focusedMoreParentId` の二重 state は、外部から scope が変わる経路（Escape の clear-scope・将来の U19 復元）で同期漏れを起こしやすい。`useEffect(() => setFocusedMoreParentId(null), [scopeFolderId])` で自己修復する形に。**U19 実装時**は復元経路でも同不変条件（scope=フォーカス行）を壊さないよう注意。
- フォーカス枠は**ペイン最外周**に置くのが自然（内側に置くと選択塗り・スコープ塗りが枠外へはみ出して見える）。ポップアップの角丸と整合させるため下角のみ `rounded-b*-xl`。
- React コンポーネント自体の結合テストが無いため、state 同期系のバグは純粋関数テストで拾えない。**U19 以降で FolderTree の scope/focus 同期を testing-library で軽量にテスト**する余地あり（今回は方針に合わせ見送り）。

**後続への影響**:
- U12（移動/D&D）: 左ペインへのドロップ先ハイライトは本単位のフラット行描画・`FolderTreeActions` を基盤に追加できる。
- U19（状態復元）: `scopeFolderId`/`focusedMoreParentId`/展開状態/クエリの保存復元。上記の同期不変条件に留意。
