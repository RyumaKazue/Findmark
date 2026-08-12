# タスクリスト — U15 import-export

## 独自JSON（packages/shared/lib/import-export）
- [x] T1. `jsonFormat.ts` を実装する（`ImportBookmark`/`ExportBookmark`型・`parseJsonFile`・`serializeJsonFile`・`CURRENT_VERSION`）
- [x] T2. `jsonFormat.test.ts` を実装する（正常パース・format/version不正・addedAt変換・シリアライズ往復）

## 標準HTML（packages/shared/lib/import-export）
- [x] T3. `htmlFormat.ts` を実装する（`parseHtmlFile`・`serializeHtmlFile`。DOM非依存の手書きパーサ）
- [x] T4. `htmlFormat.test.ts` を実装する（ネスト構造・エンティティデコード・シリアライズ・往復一致）

## ImportExportService（packages/shared/lib/import-export）
- [x] T5. `ImportExportService.ts` を実装する（`exportJson`/`exportHtml`/`importHtml`/`importJson`。BookmarkOps/AliasOps DI）
- [x] T6. `ImportExportService.test.ts` を実装する（3系統の重複解決・applyToAll一括適用・1件失敗時の継続・importHtml新規作成のみ・export内容）

## バレル export（packages/shared）
- [x] T7. `packages/shared/lib/import-export/index.ts` を作成し、`packages/shared/index.mts` に追記する

## Options UI（pages/options/src）
- [x] T8. `services.ts` を作成する（bookmarkService/aliasStore/importExportService の結線）
- [x] T9. `components/ConflictDialog.tsx` を実装する（既存/新規比較表示・skip/overwrite/keepBoth・applyToAllチェックボックス）
- [x] T10. `components/ImportExportTab.tsx` を実装する（エクスポート2種・インポート(形式判定)・ConflictResolver実装・ImportReportサマリ表示）
- [x] T11. `Options.tsx` のボイラープレートを `ImportExportTab` を描画するシェルへ置換する

## 永続ドキュメント是正
- [x] T12. `docs/functional-design.md` の `ImportExportService` インターフェース例に実装状況の注記を追加する（Blob→string・File→rawText・resolve非同期化）

## 検証
- [x] T13. `pnpm test` / `pnpm lint` / `pnpm type-check` を通す

## ゲート2 指摘対応（2026-08-11）
- [x] T14. インポートを「ファイル選択 →（選択内容を表示）→ [実行] 押下」の2段階にし、選択状態が分かる
      見た目（選択済み: accent淡背景＋ファイル名 / 未選択: グレー表記）へ変更する
- [x] T15. エクスポートの2ボタンを枠内で等幅・等間隔に配置する（`flex gap-2` の左寄せ → `grid grid-cols-2 gap-3`）

## 検証ログ

### 実装検証（implementation-validator・ラウンド1・2026-08-11）
- **指摘1（Major）**: `importOne` の new/overwrite/keepBoth 各分岐で、ブックマーク側の変更
  （create/rename+move）が成功した後に別名側の操作（upsert/merge）が失敗すると、成功したはずの
  ブックマーク変更が `ImportReport` に未計上のまま `errors` に埋もれ、実際の変更内容と乖離する。
  → **対応**: `applyAliasesSafely` を追加し、ブックマーク側のカウント（created/overwritten/keptBoth）を
  先に確定させたうえで別名操作を個別に try/catch し、失敗時は専用メッセージで `errors` へ積む（呼び出し元の
  ループを止めない）。`ImportExportService.test.ts` に2ケース追加（create成功後のalias失敗・overwrite成功後
  のalias失敗）。
- **指摘2（Minor）**: ファイル形式判定が拡張子のみで、design.mdが明記する「内容（formatフィールド）」に
  よるフォールバックが未実装。「すべてのファイル」から拡張子違いを選ぶと誤判定されうる。
  → **対応**: `jsonFormat.ts` に `isMyBookmarkSearchFile(rawText)` を追加し、`ImportExportTab` の判定を
  「拡張子 or 内容」に変更。テスト4件追加。
- **指摘3（Minor）**: `htmlFormat.ts` の `<DL>` トークン正規表現が完全一致のみで、属性付き
  `<DL COMPACT>` 等の他ツール由来バリエーションで階層が1段ずれる。
  → **対応**: `<DL[^>]*>` へ緩和（`<A>`/`<H3>` と同じ寛容さに揃える）。テスト1件追加。
- **再検証**: `pnpm test`(shared 129件 all green) / `pnpm type-check` / `pnpm lint` すべて exit 0（前景確認）。

### ラウンド2（ゲート2 ユーザー指摘・分類A 実装欠陥・2026-08-11）
- **NG報告**: インポートが「ファイルを選択→選択した瞬間に実行」になっていた。「ファイルを選択→選択→
  **[実行]を押下**→インポート」の2段階にしたい。また未選択時の「選択されていません」（ネイティブ表示）が
  分かりにくく、**選択済みだと分かる見た目**にしてほしい。
- **原因**: requirements.md は「ファイル選択→形式自動判別 or 選択→実行」と記していたが、実装が
  `onChange` で即インポートを走らせていた（実行トリガーの分離が未実装）。インポートは既存ブックマークを
  変更しうる操作のため、誤選択がそのまま実行されるのは望ましくない。
- **対応（T14）**: `ImportExportTab` に `selectedFile` state を追加し、`onChange` は選択の保持のみ・
  `[実行]` ボタン押下で `handleImport` を呼ぶ2段階に変更。ネイティブ `<input type="file">` は文言・見た目を
  制御できないため `hidden` にし、「ファイルを選択」ボタン（`click()` で委譲）＋選択状態表示に置換した。
  選択済みは accent 淡背景＋📄＋ファイル名（省略時は `title` で全文）、未選択はグレーの
  「ファイルが選択されていません」。実行中は `実行中…`、未選択時は `[実行]` を disabled にする。
- **追加指摘（見た目）**: エクスポートの2ボタンが左寄せ（`flex gap-2`）で枠内の余白が不均等だった。
  → **対応（T15）**: `grid grid-cols-2 gap-3` ＋ 各ボタン `w-full justify-center` にし、枠内で等幅・等間隔に配置。
- **再検証**: `pnpm test` / `pnpm type-check` / `pnpm lint` すべて exit 0（前景確認）。

### 受け入れ承認（2026-08-11）
承認。NG なし。

## 申し送り事項（振り返り・2026-08-11）

- **実装完了日**: 2026-08-11
- **計画と実績の差分**:
  - 計画どおり全13タスク（T1〜T13）を実装。実装検証で1件の Major・2件の Minor、ゲート2 のユーザー指摘で
    2件（T14/T15）の追加対応を行った。
  - **永続ドキュメントの是正を計画段階で織り込んだ**（T12）。functional-design.md の `ImportExportService`
    インターフェース例（`Promise<Blob>`/`File`/同期 `resolve`）は `packages/shared` の「React/DOM API 依存禁止」
    規約と矛盾しており、requirements.md の作成時点でこれを検出して「是正して実装し、完了時にドキュメントへ
    反映する」と明記できた。実装後に食い違いが発覚して慌てるパターンを回避できた。
  - `pages/options` は U15 が初めて実 UI を入れる場所だったため、tailwind のデザイントークンを popup から
    写す作業（計画外の小タスク）が発生した。
- **学んだこと**:
  - **「破壊的操作の実行トリガーは、選択・入力から明確に分離する」** — インポートは既存ブックマークを
    変更しうるのに、`<input type="file">` の `onChange` で即実行していた（T14 の指摘）。ファイル選択・
    ドロップ・フォーカスアウトのような「値が決まっただけ」のイベントを実行トリガーに使うと、ユーザーの
    「まだ確認したい」という意図を奪う。U10（インライン編集のフォーカスアウト確定）は編集内容が可逆で
    アンドゥもあるため許容だが、**アンドゥの無い一括操作では明示的な実行ボタンを置く**。U16（ゴミ箱の
    一括復元）でも同じ判断が要る。
  - **ネイティブ `<input type="file">` は文言・見た目を制御できない**（「選択されていません」はブラウザ/
    ロケール依存）。選択状態をUIで伝えたい場合は input を `hidden` にしてラベル代わりのボタンから
    `click()` で委譲し、ファイル名は自前で描画するのが定石。
  - 実装検証の Major 指摘（別名保存失敗時に、成功済みのブックマーク変更が `errors` に埋もれる）は、
    **U13・U14 に続いて3回連続で「複合操作の部分失敗時の状態整合」** が問題になった。多段の非同期操作を
    書くときは「途中まで成功した状態をどう報告するか」を最初に決めるべき。
- **次回への改善提案**:
  - U16（ゴミ箱）は本単位と同様に Options ページへタブを追加する。現状 `Options.tsx` は `ImportExportTab`
    単体を描画するシェルのため、U16 着手時に**タブ切り替え機構を導入**する（本単位では過剰な先取りを避けて
    意図的に見送った）。`SettingsTab`（保持日数・locale）も同時に入る。
  - 複合操作を持つ単位では、design.md の段階で「各ステップが失敗したときのカウント／ロールバック方針」を
    表で明示することを標準にする（U13・U14・U15 で同種の指摘が続いたため）。
