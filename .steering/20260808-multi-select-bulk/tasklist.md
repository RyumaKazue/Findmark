# タスクリスト — U13 multi-select-bulk

## 純粋モデル / フック（pages/popup/src/hooks）
- [x] T1. `selectionModel.ts` を実装する（`emptySelection` / `toggle` / `rangeTo` / `selectAll` / `clear` / `isSelected`）
- [x] T2. `selectionModel.test.ts` を実装する（toggle・range union・逆順・anchor無し→単一・selectAll・clear）
- [x] T3. `useSelection.ts` を実装する（selectionModel を React state で保持し handlers を公開）

## モードヘルパ（pages/popup/src/hooks）
- [x] T4. `modeMachine.resolveShortcutIntent` に `'select-all'`（Ctrl/Cmd+A）を追加し `modeMachine.test.ts` を更新する

## サービス層（pages/popup/src/hooks）
- [x] T5. `useRowActions` に `moveRows` / `deleteRows`（一括・1アンドゥ単位・部分失敗ハンドリング）を追加する
- [x] T5.1. `bulkActionsCore.ts`（純粋・DI）+ `bulkActionsCore.test.ts` を実装し、`moveRows`/`deleteRows` の
      中核（対象フィルタ・forward/undo 双方の部分失敗耐性）をテスト可能にする（実装検証ラウンド1で追加）

## UI コンポーネント（pages/popup/src/components）
- [x] T6. `BulkActionBar.tsx` を実装する（N件選択中・[移動]/[削除]/[選択解除]・design 1f トークン）
- [x] T7. `ResultRow.tsx` にチェックボックス段階表示（通常/ホバー/選択中）と修飾クリック分岐（Ctrl/Shift）を追加する
- [x] T8. `ResultList.tsx` に selection 中継 props（selectionActive/selectedIds/onToggleSelect/onRangeSelect）を追加する

## 結線（Popup）
- [x] T9. `Popup.tsx` に `useSelection` を結線し、ヘッダーの SearchHeader↔BulkActionBar 差し替えを行う
- [x] T10. `Popup.tsx` に選択操作（Ctrl/Cmd+クリック・Shift+クリック・Ctrl/Cmd+A）を結線する
- [x] T11. `Popup.tsx` に一括バーのアクション（移動=MovePanel 一括・削除=deleteRows・選択解除）を結線する
- [x] T12. `Popup.tsx` に一括ドラッグ（選択中の行をドラッグで全件・ゴースト件数 N・onDrop で moveRows）を結線する
- [x] T13. `Popup.tsx` に選択の破棄（クエリ/スコープ変更・Escape 先頭・一括操作後）を結線する

## 検証
- [x] T14. `pnpm test` / `pnpm lint` / `pnpm type-check` を通す

## 検証ログ

### 実装検証（implementation-validator・ラウンド1・2026-08-08）
- **指摘1（Major）**: `moveRows`/`deleteRows` の undo クロージャが単一 try で全件を包んでおり、部分失敗時に
  ①失敗以降の件が戻されない、②成功済みの件が `refresh()` されず索引とUIが乖離する、という AC-4「1アンドゥで
  全戻し」を壊しうる不備。→ **対応**: forward 側と同じ「1件ごとに独立した try/catch」パターンへ修正。
- **指摘2（Minor）**: AC-5「moveRows・deleteRowsの骨格にユニットテストがある」と design.md「直接テストは
  持たない」が矛盾しており、指摘1のような核心ロジックの不備が自動テストで検出できない状態だった。
  → **対応**: 対象フィルタ・部分失敗耐性の中核を `bulkActionsCore.ts`（React/chrome 非依存・DI）へ切り出し、
  `bulkActionsCore.test.ts`（11ケース: 全件成功/部分失敗/undo部分失敗を forward・undo 双方で検証）を追加。
  `useRowActions.ts` はこの中核へ委譲する薄いアダプタに整理。design.md のテスト方針を実装に合わせて更新。
- **指摘3（Minor）**: `ResultRow.handleMouseDown` の D&D 開始除外リストに `[data-checkbox-area]` が
  含まれておらず、チェックボックスクリックの微小なブレでドラッグが誤発火しうる。→ **対応**: 除外リストに追加。
- **再検証**: `pnpm test`(168件 all green) / `pnpm type-check` / `pnpm lint` すべて exit 0（前景確認）。

### 受け入れ承認（2026-08-08）
承認。NG なし。

## 申し送り事項（振り返り・2026-08-08）

- **実装完了日**: 2026-08-08
- **計画と実績の差分**:
  - 計画どおり全14タスク（T1〜T14）を実装。実装検証（implementation-validator）で1件の Major 指摘
    （一括アンドゥの部分失敗耐性）を受け、計画外の T5.1（`bulkActionsCore.ts` の切り出し + テスト11件）を
    追加した。これは「AC-5 が求めるユニットテスト」と「design.md の "useRowActions は直接テストしない"
    方針」の矛盾が実際にバグを見逃す形で顕在化した結果であり、設計段階でこの矛盾に気づけていればより
    早く対処できた（次回への改善提案に反映）。
  - 選択状態（`useSelection`）をモードにせず独立フックにする設計判断は狙いどおり機能し、既存の
    `useMode`/`FocusArea` 周りのロジックに一切手を入れずに複数選択を追加できた。
- **学んだこと**:
  - **「テストしない」という設計判断は、対象ロジックが本当に単純な場合にのみ有効**。`useRowActions` の
    単一版（`moveRow`/`deleteRow`）は「1件の成功/失敗」だけなので直接テスト省略は妥当だったが、一括版は
    「N件中の部分失敗」という組み合わせ的な複雑さを持ち込んだため、同じ判断をそのまま踏襲したのは誤りだった。
    **DIさえ効いていれば chrome API 依存のロジックでも Node 環境でユニットテスト可能**（`SearchEngine`/
    `AliasStore` と同じ方針）であり、複雑な非同期制御フロー（部分失敗・undo）を持つロジックは複雑さの
    程度に関わらず抽出してテストする価値がある。
  - 一括操作の undo は「1回で消費される」性質上、forward処理と全く同じ「1件ごと独立処理」の規律を
    undo側にも機械的に適用すべきという教訓は、今後 U16（ゴミ箱の一括復元等）にも当てはまる。
- **次回への改善提案**:
  - 一括系の作業単位（例: 将来の一括タグ付け等）を計画する際は、design.md 作成時点で「forward側だけでなく
    undo側の部分失敗耐性」を明示的にチェックリスト化する。
  - `.steering/` の design.md は実装内容と乖離した場合、実装検証の指摘を機に都度更新する運用が機能した
    （今回 T5.1 で反映済み）。今後もこの運用を継続する。
