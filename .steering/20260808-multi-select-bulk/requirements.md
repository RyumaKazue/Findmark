# 要求内容 — U13 multi-select-bulk

## 概要

検索結果の行を**複数選択**し、**一括で移動 / 削除**できるようにする。選択操作は3系統（`Ctrl/Cmd+クリック`で個別トグル・`Shift+クリック`で範囲選択・`Ctrl/Cmd+A`で全件選択）。1件以上選択中はヘッダーが**一括操作バー**（「N件選択中 [移動] [削除] [選択解除]」）へ差し替わり、行のファビコン位置が**チェックボックス**に変化する。一括操作は U10 の `UndoManager` を用いて**1アンドゥ単位**（N件移動/削除が1回の「元に戻す」で全部戻る）で保護する。

## 背景

Findmark の中核価値「検索結果の場で完結する整理」（PRD）を、複数件まとめて処理できるよう拡張する。U10 で単一行の削除、U12 で単一行の移動（キーボード/D&D・即時アンドゥ）が完成した。本単位はそれらを**一括操作**へ広げ、1件ずつ処理する手間をなくす（PRD 機能8）。

選択状態はモード（U8）やスコープ（U11）と直交する新しい UI 状態であり、フォーカス（`selectedIndex`）とも独立する（Gmail/Finder 型: ハイライトとチェック選択は別軸）。一括操作の実体（chrome API 呼び出し）は既存 `BookmarkService` に閉じ、`useRowActions` に一括版（`moveRows`/`deleteRows`）を追加して単一版（U10/U12）と骨格を揃える。

- 引用元:
  - PRD 機能8「複数選択と一括操作」（`docs/product-requirements.md`）
  - functional-design「UndoManager(即時アンドゥ)」= 削除・移動・**一括操作を1単位**として保持（`docs/functional-design.md` L344）
  - functional-design「チェックボックスの段階表示」表（通常=ファビコン / ホバー=チェックボックス / 1件以上選択中=全行常時表示）（同上 L826-831）
  - functional-design「状態→作業単位 1f = 複数選択中（ヘッダーが一括操作バーへ切替）」（同上 L808）
  - `docs/design/README.md`「1f — 複数選択中（一括操作バー）」視覚仕様の正（ヘッダー差し替え・3ボタン・チェックボックス）
  - `docs/design/README.md`「1g」件数バッジ（複数選択時のドラッグは全件をまとめて運ぶ）
  - architecture.md レイヤー依存「UI → サービス → データ」
  - repository-structure.md `hooks/useSelection.ts` の配置

## 実装対象の機能

### 1. 選択状態（`selectionModel.ts` + `useSelection.ts`）

- 純粋モデル `selectionModel.ts`: `Set<string>`（選択ブックマーク ID）＋ `anchorId`（範囲選択の起点）に対する純粋操作。
  - `toggle(state, id)`: 個別トグル（Ctrl/Cmd+クリック）。anchor を id に更新。
  - `rangeTo(state, targetId, orderedIds)`: anchor〜target の連続範囲を選択に加える（Shift+クリック）。anchor 無しなら単一選択に倒す。
  - `selectAll(orderedIds)` / `clear()` / `isSelected` / ヘルパ。
- フック `useSelection.ts`: 上記を React state で保持し、`selectedIds`（`ReadonlySet`）・`count`・各操作を公開する。

### 2. 選択操作の結線（3系統）

- **Ctrl/Cmd+クリック**: 当該行を個別トグル（開かない）。
- **Shift+クリック**: anchor〜当該行を範囲選択（開かない）。
- **Ctrl/Cmd+A**: 全件選択。検索ボックス入力中（`listFocus==='search'`）は**ネイティブのテキスト全選択を優先**し奪わない。右ペイン（`listFocus==='result'`）で全件選択する。`modeMachine.resolveShortcutIntent` に `select-all` を追加する。
- **チェックボックスのクリック**: 当該行をトグル（修飾キー不要）。
- 素のクリックは従来どおり「開く」。

### 3. チェックボックスの段階表示（`ResultRow` / デザイン 1f）

- 通常: ファビコンのみ。
- ホバー: ファビコン位置がチェックボックスに変化（Gmail/Finder 挙動）。
- **1件以上選択中**: 全行で常時チェックボックス表示。選択済み = accent 塗り + 白 `✓`、行背景 `#F4F6FE`、別名チップ bg は選択色。未選択 = 白枠。切替でレイアウトが動かない（同寸）。

### 4. 一括操作バー（`BulkActionBar.tsx` / デザイン 1f）

- 1件以上選択中はヘッダー（`SearchHeader`）を `BulkActionBar` へ差し替える。
- 表示: 左「N件選択中」、右に **[移動]**（accent 塗り）・**[削除]**（危険色枠）・**[選択解除]**（テキスト）。
- [移動] → 一括移動用に `MovePanel` を開く（PANEL モード・現在の親の無効化は一括では行わない）。確定で選択全件を移動。
- [削除] → 選択全件を削除（1アンドゥ）。
- [選択解除] → 選択クリア（`SearchHeader` へ戻る）。

### 5. 一括操作オーケストレーション（`useRowActions` 拡張）

- `moveRows(items, targetFolderId, targetFolderPath)`: 各件を `move`＋`moveNode` → `refresh` 1回 → **1つの undo**（全件を元の親へ戻す）を登録。ラベル「N件を移動しました」。同一親の件・移動先=現在の親の件はスキップ。
- `deleteRows(items)`: 各件を `remove`＋`aliasStore.remove`＋`removeNode` → `refresh` 1回 → **1つの undo**（全件を再作成＋別名復帰）を登録。ラベル「N件を削除しました」。
- 失敗は既存同様ログ＋エラートースト。索引と実データの乖離を作らない。

### 6. 一括ドラッグ（デザイン 1g・複数選択時は全件を運ぶ）

- 選択中の行をドラッグ開始したら、**選択全件**をまとめて運ぶ（ゴーストの件数バッジ = N）。選択外の行のドラッグは従来どおり単一（件数 1）。ドロップで `moveRows`（複数）または `moveRow`（単一）。
- 実装は Popup 側で一/多を判定（`useDragAndDrop` の中核は変更しない）。

### 7. 選択の破棄タイミング

- スコープ変更・クエリ変更で選択をクリアする（選択は常に「現在の表示結果の部分集合」に保ち、幽霊選択・件数不整合を避ける）。
- `Escape` は選択が非空なら**最初に選択をクリア**する（既存の段階戻りより前段）。
- 一括操作（移動/削除）完了後は選択をクリアする。

## 受け入れ基準

`docs/mvp-development-flow.md` U13 行および PRD 機能8・functional-design を出典とする。

- [ ] **AC-1（3種の選択操作）**: `Ctrl/Cmd+クリック`で個別追加、`Shift+クリック`で範囲選択、`Ctrl/Cmd+A`で全件選択できる。［PRD 機能8 / mvp-flow U13「3種の選択操作」］
- [ ] **AC-2（チェックボックス段階表示）**: 通常はファビコンのみ、ホバーでチェックボックスに変化、1件以上選択中は全行で常時表示。切替でレイアウトが動かない。［PRD 機能8 / functional-design 段階表示表］
- [ ] **AC-3（一括操作バー）**: 1件以上選択中はヘッダーが「N件選択中 [移動] [削除] [選択解除]」に切り替わる。［PRD 機能8 / mvp-flow U13「選択中は一括操作バー表示」/ design 1f］
- [ ] **AC-4（一括アンドゥ1単位）**: 一括移動/削除のアンドゥが1回で全戻しになる（例: 20件移動が1回の「元に戻す」で全部戻る）。［PRD 機能8 / mvp-flow U13「一括アンドゥが1回で全戻し」/ functional-design L344］
- [ ] **AC-5（品質ゲート）**: `pnpm test` / `pnpm lint` / `pnpm type-check` が通る。追加ロジック（`selectionModel` / `moveRows`・`deleteRows` の骨格）にユニットテストがある。

## スコープ外（本単位に含めない）

- ゴミ箱（30日）連携（U16）。本単位の一括削除は即時アンドゥ（5秒）まで。
- 一括操作バーのボタンのキーボード到達性の追加ショートカット（移動=Ctrl+M・削除=Delete は選択中に一括へ適用する形で流用。新規キーは増やさない）。
- 選択のクエリ横断保持（本単位はクエリ/スコープ変更で選択クリア）。
