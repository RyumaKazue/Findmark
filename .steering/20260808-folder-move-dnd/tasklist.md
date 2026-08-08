# タスクリスト — U12 folder-move-dnd

## データ層（packages/shared）
- [x] T1. `SearchEngine.moveNode(id, parentId, folderPath)` を実装する（`updateNode` に倣った部分更新・id 不一致 no-op）
- [x] T2. `SearchEngine` テストに `moveNode` のケースを追加する（folderPath 更新 / スコープ判定が新親で動く / id 不一致 no-op）

## 純粋モデル（pages/popup/src/components）
- [x] T3. `dragModel.ts` を実装する（`exceedsThreshold` / `autoScrollDirection` / `isValidDropTarget` と定数）
- [x] T4. `dragModel.test.ts` を実装する（5px 境界・上下端/中央・null/現在の親/別フォルダ）
- [x] T5. `movePanelModel.ts` を実装する（`buildMoveCandidates` / `filterCandidates` / `clampIndex`）
- [x] T6. `movePanelModel.test.ts` を実装する（フラット化・disabled 付与・正規化部分一致・空クエリ・clamp）

## サービス層（pages/popup/src/hooks）
- [x] T7. `useRowActions` に `moveRow(item, targetFolderId, targetFolderPath)` を追加する（move → moveNode → refresh → undo 登録・同一親 no-op・失敗時エラー）

## モードヘルパ（packages/shared）
- [x] T8. `modeMachine.isSearchFirstExempt` に `'DRAG'` を追加し、`modeMachine.test.ts` を更新する

## UI コンポーネント（pages/popup/src/components）
- [x] T9. `MovePanel.tsx` を実装する（絞り込み input・候補リスト・PANEL キー解決・disabled 表示/確定弾き・クリック確定）
- [x] T10. `DragGhost.tsx` を実装する（design 1g のゴースト・件数バッジ）
- [x] T11. `FolderTreeItem.tsx` にドロップ先属性（`data-folder-id`）とドロップハイライト（`dropTarget`）を追加する
- [x] T12. `FolderTree.tsx` に `dropTargetId` prop と `FolderTreeActions.expand(id)` を追加する
- [x] T13. `ResultRow.tsx` / `ResultList.tsx` に行のドラッグ開始（`onDragStart`/`onRowMouseDown`）を配線する（編集中行は除外）

## フック（pages/popup/src/hooks）
- [x] T14. `useDragAndDrop.ts` を実装する（5px 開始・ゴースト追従・ドロップ判定・スプリングロード600ms・オートスクロール40px・Escape/外ドロップ中止）

## 結線（Popup）
- [x] T15. `Popup.tsx` に MovePanel（Ctrl+M / PANEL 描画 / 確定 / 対象消失で復帰）を結線する
- [x] T16. `Popup.tsx` に useDragAndDrop / DragGhost / FolderTree の dropTargetId を結線する

## 検証
- [x] T17. `pnpm test` / `pnpm lint` / `pnpm type-check` を通す

## 検証ログ

### ラウンド1（2026-08-08）
- **NG報告（手動テスト）**: ドラッグでブックマークを移動したら表示されなくなった。
- **原因**: 特定フォルダにスコープを当てた状態で、そのフォルダ外へ移動すると、スコープの直下判定（`SearchEngine.inScope`: `parentId === scope.folderId`）で当該行が一覧から外れる。U6a のスコープ仕様と機能7「消さず」の整合が未定義だった（分類C: 要件の認識ズレ）。「すべて」表示では従来どおり残る。
- **決定（ユーザー確認）**: **現状の挙動でよい**。スコープ中フォルダ外への移動で行が消えるのは「そのフォルダから取り出した」直感と一致するため、スコープの直下表示ルールを優先する。
- **対応**: コード変更なし。docs/functional-design.md UC-3 に注記を追加、requirements.md AC-6 を明確化して整合を取った。品質ゲート（test/lint/type-check）は前回の緑を維持。
- **ラウンド2（追試）**: 「その他のブックマークの中身だけ表示される」も同一原因（右ペインが当該フォルダにスコープ中）。「すべて」/Home で復旧することをユーザーが確認（「直りました」）。追加対応なし。

## 申し送り事項（振り返り・2026-08-08）

- **実装完了日**: 2026-08-08
- **計画と実績の差分**:
  - ほぼ計画どおり全17タスクを実装。追加ロジック（`SearchEngine.moveNode` / `dragModel` / `movePanelModel`）はユニットテストで担保。
  - `isSearchFirstExempt` に `'DRAG'` を追加（T8）。U8 で「後続単位が DRAG/PANEL を担う」と前方宣言されていたヘルパの完成であり、完了済み U8 の意思決定を覆すものではない（`modeMachine.test.ts` も更新）。
  - implementation-validator の Blocker（MovePanel の Tab でフォーカスが外へ逃げてキー操作が壊れる）を修正: キー処理をパネルルートへ委譲＋`Tab` フォーカストラップ＋候補ボタンを非フォーカス化。
  - 推奨対応: 行ドラッグを ✎/🗑・別名エリア上で除外、移動アンドゥの `originalParentId === undefined` 時に `setError` 通知。
- **学んだこと**:
  - 機能7「移動しても消さず」と U6a スコープ仕様（直下のみ）は本質的に競合しうる。スコープ中フォルダ外への移動は行が一覧から外れる（＝取り出し）挙動を正とし、docs に明記した。ユーザーの手動テストで2回この点が挙がったため、リリース準備（U18）の説明文・オンボーディングで「Home/『すべて』で全体に戻れる」ことを触れると親切。
  - 品質ゲートは**前景で実 exit code を確認**する運用が有効だった（[[turbo-gate-foreground]]）。実際、lint はバックグラウンド通知が exit 0 に見えて実際は失敗していた一幕があり、前景確認で検知できた。
- **次回への改善提案**:
  - PANEL モードの対象行が `mode.targetId` ではなく `selectedIndex` 依存になっている（validator 指摘・構造リスク）。将来ブックマークのライブ購読を入れる場合は `ENTER_PANEL` に `targetId` を持たせて `results.find` で解決する形へ揃えるとよい（本単位では実害なしのため見送り）。
  - D&D の DOM 結線（`useDragAndDrop`）はユニットテスト困難なため、E2E（U18 前後）でスプリングロード/オートスクロール/中止の主要導線を1本通すと安心。
  - `useRowActions` 自体の直接テスト（move/delete/commit の分岐）は既存単位でも未整備。今後まとめて追加する価値あり。
