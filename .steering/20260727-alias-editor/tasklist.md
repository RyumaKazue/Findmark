# タスクリスト — U9 alias-editor

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

---

## フェーズ1: データ層・純粋ロジック

- [x] `packages/storage/lib/impl/aliasStore.ts` の上限定数を export
  - [x] `MAX_ALIASES` / `MAX_ALIAS_LENGTH` を export し、既存の内部利用を維持
- [x] `pages/popup/src/components/aliasEditorModel.ts`（純粋・新規）を実装
  - [x] 上限定数を `@extension/storage` から取り込み（再定義しない）
  - [x] `commitAlias(existing, raw, normalize)`（added/duplicate/empty/too-long/at-limit の判別ユニオン）
  - [x] `removeAt` / `removeLast`（不変で新配列返却）
  - [x] `orderMatchedFirst(aliases, matched)`（マッチ先頭・順序安定）
- [x] `pages/popup/src/components/aliasEditorModel.test.ts` を作成
  - [x] `commitAlias`: added / empty / too-long / duplicate(正規化一致で index 返却) / at-limit
  - [x] `removeAt` / `removeLast` の境界
  - [x] `orderMatchedFirst` のマッチ先頭・順序安定・マッチ不在
  - [x] 実 `normalizer`（@extension/shared）を注入した重複判定

## フェーズ2: 検索索引への即時反映

- [x] `packages/shared/lib/search/SearchEngine.ts` に `updateAliases(url, aliases)` を追加
  - [x] 同一 `hashUrl` のエントリの `aliases`/`nAliases` を差し替え
  - [x] 不正 URL はスキップ（索引を落とさない）
- [x] `packages/shared/lib/search/SearchEngine.test.ts` に `updateAliases` のテストを追加
  - [x] 旧別名で不一致・新別名で一致になること
  - [x] 同一正規化URLの複数エントリに適用されること
- [x] `pages/popup/src/hooks/useSearch.ts` に `updateAliases` と `indexVersion` を追加
  - [x] `updateAliases` で索引更新＋バージョン増分
  - [x] `useMemo(results)` 依存に `indexVersion` を追加

## フェーズ3: AliasEditor UI

- [x] `pages/popup/src/components/AliasEditor.tsx`（新規）を実装
  - [x] 状態1e のチップ入力ボックス（既存チップ＋`✕`／入力欄／ヒント／`n/20` 上限表示）
  - [x] Enter/`,`/Space で確定（IME `isComposing` 時はスキップ、`,`/Space は preventDefault）
  - [x] 空入力 Backspace で末尾チップ削除、チップ `✕` で個別削除、チップクリックで再編集
  - [x] マッチ別名を先頭・accent 強調で表示
  - [x] 重複時に該当既存チップを blink（タイマーで className を解除）
  - [x] 別名変更ごとに `onCommit(aliases)`（楽観更新→失敗でロールバック）
  - [x] マウント時に入力欄 autoFocus、Escape で `onClose`

## フェーズ4: 結線（ResultRow / ResultList / Popup）

- [x] `ResultRow.tsx` を変更
  - [x] `editingAlias` 時は `<div>` コンテナで 1段目テキスト＋2段目 `AliasEditor` を描画
  - [x] 通常時は 2段目別名エリアのクリックで `onEnterAliasEdit`（単一 button 上で data 属性判定・ネスト回避）
- [x] `ResultList.tsx` を変更
  - [x] `editingAliasId` と AliasEditor 用コールバックを受け取り対象行へ渡す
- [x] `Popup.tsx` を変更
  - [x] LIST で選択行あり時に `resolveShortcutIntent` の `alias-edit` で `enterAliasEdit(node.id)`
  - [x] `mode.targetId` から対象 item を解決（消失時は `exitToList`）
  - [x] `onCommit`（upsert→updateAliases）/ `onClose`（exitToList＋検索フォーカス）を供給
  - [x] 別名エリアクリックからの `enterAliasEdit` 結線

## フェーズ5: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `pnpm test`（12/12 パッケージ成功・popup 56 tests / shared updateAliases 追加）
- [x] リントエラーがないことを確認
  - [x] `pnpm lint`（popup/shared/storage をフォアグラウンドで exit code 確認・clean）
- [x] 型エラーがないことを確認
  - [x] `pnpm type-check`（14/14 成功）

## フェーズ6: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.md の各要件）と実装を突き合わせ OK/NG を一覧化
- [x] ユーザーに検証を依頼
- [x] 受け入れ承認（ゲート2）を取得（2026-07-27。ラウンド1・2 の修正を経て承認）
  - NG があった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ7: ドキュメント更新・振り返り（モード4）

- [x] `docs/mvp-development-flow.md` の進捗表で U9 を「✅ 完了」に更新
- [x] 実装後の振り返り（このファイル下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

- ラウンド1（2026-07-27）
  - 不一致内容: ① 別名入力欄が空の状態で Enter を押しても閉じない（入力終了の導線が無い）。② `https://claude.ai/new#settings/usage` と `https://claude.ai/new` の一方に別名を付けると両方に反映される。
  - 分類: ①=A（実装欠陥・U9） / ②=B（設計の前提崩れ・U3 normalizer-core）。②は `normalizeUrl` がフラグメント（`#...`）を除去する設計で、ハッシュルーティングの SPA（claude.ai 等）では異なるページが同一 urlHash に衝突し別名レコードを共有してしまう。フラグメントはページ同一性を変えないという前提が SPA で成立しない。
  - 戻り先: ①=モード2（`AliasEditor.tsx`）。②=`packages/shared/lib/search/Normalizer.ts`（U3）＋永続ドキュメント `docs/functional-design.md`「URL正規化とハッシュ」。
  - 対応: ① 空入力での Enter を `onClose` に割り当て。② `normalizeUrl` を「フラグメント保持」に変更（`u.hash` を正規形に含める）。異なるフラグメント＝別ページ＝別 urlHash となり、別名が独立する。Normalizer テスト・SearchEngine 連携・functional-design を整合。ユーザー指示による修正のため計画再承認は本ラウンドの受け入れ確認に統合。

- ラウンド2（2026-07-27）
  - 不一致内容: ① 空入力 Enter で編集を閉じる際に、編集中ブックマークのページまで開いてしまう。② 別名編集中に別の行の別名／「＋別名」をクリックしても現在の入力が閉じない（対象を切り替えられない）。
  - 分類: ①=A（実装欠陥・イベント伝播） / ②=A（実装欠陥・モード遷移の入口制限）。
  - 戻り先: ①/②とも モード2（`AliasEditor.tsx` / `Popup.tsx`）。
  - 対応: ① `AliasEditor` が処理するキー（Enter/`,`/Space/Backspace/Escape）で `e.stopPropagation()` を呼び、document レベルの LIST キーハンドラへ伝播させない（React の stopPropagation は nativeEvent にも作用）。閉じる Enter が「開く」に化ける事象を解消。② `enterAliasEditAt` を「一旦 `exitToList` してから `enterAliasEdit`」に変更し、編集中でも別行へ切り替え可能に（`ENTER_ALIAS_EDIT` は LIST からのみ有効なため）。

---

## 実装後の振り返り

### 実装完了日
2026-07-27

### 計画と実績の差分

**計画と異なった点**:
- `useSearch` の即時反映機構を、当初計画の `indexVersion` カウンタ＋`useMemo` 方式から、`runSearch()` を単一 source とする `setResults` 方式へ変更。理由: 未参照の依存を持つ `useMemo` が `react-hooks/exhaustive-deps` の「unnecessary dependency」警告を生むため。design.md も追従更新済み。
- 別名エリアのマウス入口を、当初想定の「チップ領域を独立 interactive 要素にする」案から、「単一 `<button>` 上で `data-alias-area` 属性を見て分岐」する案へ変更。理由: button-in-button（nested interactive）が HTML 的に不正かつ jsx-a11y に抵触するため。
- 上限定数の export 位置を、宣言箇所の `export const` から末尾の `export { ... }` へ変更。理由: `import-x/exports-last` ルール。

**新たに必要になったタスク（検証で追加）**:
- ラウンド1: 空エンターで閉じる導線（A）／ハッシュルーティング SPA の別名誤共有（B・`normalizeUrl` フラグメント保持）。後者は U3 と `docs/functional-design.md`・`docs/glossary.md` の是正を伴った。
- ラウンド2: 閉じる Enter がページを開く事象（A・`stopPropagation` でイベント伝播遮断）／別行クリックで編集対象を切替（A・`exitToList`→`enterAliasEdit`）。

**技術的理由でスキップしたタスク**: なし（全タスク完了）。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 2
- 主な不一致と分類: ラウンド1= A×1・B×1（URL 正規化のフラグメント保持）、ラウンド2= A×2。
- 受け入れ承認: 2026-07-27 取得。

### 学んだこと

**技術的な学び**:
- React の `SyntheticEvent.stopPropagation()` は内部で `nativeEvent.stopPropagation()` を呼ぶため、`document.addEventListener` で張ったネイティブリスナー（Popup の LIST キーハンドラ）への伝播も止められる。自前入力ウィジェットが処理するキーは伝播を止めて「グローバルキー操作への漏れ」を防ぐのが定石。
- 別名の同一性は URL 正規化ハッシュに依存するため、`normalizeUrl` の正規化ポリシー（フラグメント除去/保持）が別名の粒度を直接決める。ハッシュルーティングの SPA ではフラグメントがページ identity を担うため、除去すると別ページの別名が衝突する。Chrome のブックマーク identity（フラグメント違いは別エントリ）に揃えるのが安全。
- モード状態機械の入口が「LIST からのみ」設計だと、編集中の対象切替は「一旦 exit→enter」で表現する必要がある。

**プロセス上の改善点**:
- 品質ゲート（特に lint）は turbo の TUI バックグラウンド実行が prettier エラーを見落として exit 0 を返すことがあった。フォアグラウンドで exit code を確認する運用（既存メモ [[turbo-gate-foreground]]）が今回も有効だった。
- implementation-validator の指摘（データロス・仮想スクロール整合）を受け入れ前に取り込めたため、ユーザー検証は主に実挙動（SPA別名・閉じる導線）に集中できた。

### 次回への改善提案
- 可変高の行（別名編集=1e、インライン編集=1d）を固定行高の仮想スクロールに載せる整合は U9 でも残課題として上乗せ対応に留めた。U10 で本格的な動的行高対応（実測ベースのオフセット計算 or 編集時の非仮想化フォールバック）を検討するのが望ましい。
- URL 正規化ポリシー（クエリ/フラグメント/トラッキングパラメータの扱い）は別名粒度に直結するため、Post-MVP で `utm_*` 除去等を入れる際は別名キー移行の影響を必ず併記する。
