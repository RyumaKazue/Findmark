# 要求内容 — U15 import-export

## 概要

オプションページに「インポート/エクスポート」機能を実装する。**独自JSON形式**（`format: "my-bookmark-search"`, `version`, 別名を含む）と**標準HTML形式**（Netscape Bookmark File。別名は含めない）の両方に対応する。独自JSONのインポートはURLをキーに既存ブックマークと突合し、①新規（作成+別名登録）②別名のみ差分（マージ）③タイトル/フォルダ相違（ユーザーが skip/overwrite/keepBoth を選択・一括適用可）の3系統で重複解決する。ファイルダイアログでポップアップが閉じてしまう制約のため、本機能はオプションページに配置する。

## 背景

Findmark の非機能要件「プライバシー」「別名ごと持ち運べる移行」を実現する最後の主要機能。U4（BookmarkService）・U5（AliasStore）が提供する `ensureFolderPath`/`create`/`upsert`/`merge` 等のプリミティブを組み合わせて、環境間の資産移行（インポート）と離脱時のデータ保全（エクスポート）を成立させる。

- 引用元:
  - PRD 機能11「インポート / エクスポート(オプションページ)」（`docs/product-requirements.md`）
  - functional-design「ImportExportService(オプションページ)」コンポーネント設計・「独自JSONフォーマット」・「UC-4: 独自JSONインポート(重複解決)」（`docs/functional-design.md`）
  - functional-design「エラーハンドリング」表 `インポートのパース失敗` / `復元先フォルダ消失`（同上）
  - functional-design「テスト戦略」`ImportExportService: 独自JSONの3系統の重複解決、version マイグレーション`（同上）
  - architecture.md「レイヤー依存」「外部通信ゼロ」「packages/shared は React/DOM に依存禁止」
  - repository-structure.md `packages/shared/lib/import-export/{ImportExportService,jsonFormat,htmlFormat}.ts`・`pages/options/src/components/{ImportExportTab,ConflictDialog}.tsx` の配置

**実装上の是正（永続ドキュメントへ反映する）**: functional-design.md の `ImportExportService` インターフェース例は `exportJson(): Promise<Blob>` / `importJson(file: File, resolver)` / `resolve(...)`（同期）としているが、`packages/shared` は「React/DOM API に依存禁止」（repository-structure.md）である。`Blob`/`File` は DOM/File API であり、実際のUI操作で resolver がユーザー入力を待つには非同期でなければならない。よって実装は **`exportJson()/exportHtml(): Promise<string>`**（生テキストを返し、Blob化はダウンロードを扱う `pages/options` 側が担う）・**`importJson(rawText: string, resolver)/importHtml(rawText: string)`**（ファイル読み込みも options 側が担う）・**`ConflictResolver.resolve(...): Promise<{resolution, applyToAll}>`**（非同期）に是正する。本単位の完了時に `docs/functional-design.md` を実装に合わせて更新する。

## 実装対象の機能

### 1. 独自JSONフォーマットの型とマイグレーション（`packages/shared/lib/import-export/jsonFormat.ts`）

- `format: "my-bookmark-search"` / `version` / `exportedAt`(ISO8601) / `bookmarks[]`(`url`/`title`/`folderPath`/`aliases`/`addedAt`(ISO8601・任意)) のスキーマ。
- `parseJsonFile(rawText: string): ImportBookmark[]` — `format`/`version` を検証し、不正なら例外（呼び出し側が「ファイル形式が不正です(format/version を確認)」を表示）。`version` ごとの分岐を持つ構造にし、将来のフォーマット変更に備える（現状は `version: 1` のみ）。
- `serializeJsonFile(bookmarks: ExportBookmark[]): string` — 現行 `version` で出力する。

### 2. 標準HTML(Netscape Bookmark File)の入出力（`packages/shared/lib/import-export/htmlFormat.ts`）

- DOM API 非依存（`packages/shared` の制約）の手書きパーサ/シリアライザとする（`<DL><DT><H3>`/`<DT><A HREF>` の入れ子構造は正規のため、軽量な文字列走査で十分）。
- `parseHtmlFile(html: string): ImportBookmark[]` — フォルダ階層を `folderPath` に、別名は常に空配列。
- `serializeHtmlFile(tree: BookmarkNode[]): string` — フォルダ階層を `<DL>` の入れ子として出力する（別名は含めない）。

### 3. ImportExportService（`packages/shared/lib/import-export/ImportExportService.ts`）

- `exportJson(): Promise<string>` / `exportHtml(): Promise<string>` — `BookmarkOps.getTree()` + `AliasOps.getAll()`（JSON のみ）から生成する。
- `importHtml(rawText: string): Promise<ImportReport>` — 新規作成のみ（`ensureFolderPath` + `create`）。重複解決なし。
- `importJson(rawText: string, resolver: ConflictResolver): Promise<ImportReport>` — URLで既存検索 → 3系統に分岐（UC-4）。
- 依存（`BookmarkOps`/`AliasOps`/正規化）は `SearchEngine`/`AliasStore` と同じ DI 方針で構造的インターフェースとして注入する（`BookmarkService`/`AliasStore`/`Normalizer` が構造的に満たす）。

### 4. Options UI（`pages/options/src/components/`）

- `ImportExportTab.tsx`: エクスポート（独自JSON/標準HTML の2ボタン、ダウンロードをトリガー）とインポート（ファイル選択→形式自動判別 or 選択→実行）、結果サマリ（`ImportReport`）表示。
- `ConflictDialog.tsx`: タイトル/フォルダ相違時に既存/新規を並べて表示し、skip/overwrite/keepBoth を選ばせる。「残りの競合にも適用する」チェックボックス（`applyToAll`）。
- `Options.tsx`: U7 と同じ扱いでボイラープレートのデモUIを置換し、`ImportExportTab` を描画する。
- `pages/options/src/services.ts`: `bookmarkService`/`aliasStore`/`importExportService` の結線（popup の `services.ts` と同じ集約パターン）。

## 受け入れ基準

`docs/mvp-development-flow.md` U15 行および PRD 機能11・functional-design UC-4 を出典とする。

- [ ] **AC-1（配置）**: 本機能はオプションページに配置される（ポップアップには置かない）。［PRD 機能11「ファイルダイアログでポップアップが閉じる制約」］
- [ ] **AC-2（標準HTML入出力）**: 標準HTML形式(Netscape Bookmark File)の入出力に対応する。インポートは新規作成のみのシンプル動作。［PRD 機能11］
- [ ] **AC-3（独自JSON入出力）**: 独自JSON形式(`format`/`version`/`bookmarks[]`)で url/title/folderPath/aliases/addedAt を入出力する。［PRD 機能11 / functional-design「独自JSONフォーマット」］
- [ ] **AC-4（URL突合・フォルダ自動作成）**: 独自JSONインポート時、URLをキーに突合し、存在しないフォルダは自動作成する。［PRD 機能11］
- [ ] **AC-5（3系統の重複解決）**: 同一URLなし→新規作成+別名登録 / 別名のみ差分→別名マージ / タイトル・フォルダ相違→skip/overwrite/keepBoth をユーザー選択（一括適用可）。［PRD 機能11 / functional-design UC-4］
- [ ] **AC-6（バージョン後方互換）**: `version` により将来のフォーマット変更後も旧ファイルを読める設計とする。［PRD 機能11］
- [ ] **AC-7（品質ゲート）**: `pnpm test` / `pnpm lint` / `pnpm type-check` が通る。`ImportExportService` の3系統の重複解決・version マイグレーションにユニットテストがある（functional-design「テスト戦略」）。

## スコープ外（本単位に含めない）

- ゴミ箱（U16）・Service Worker（U17）連携。
- インポート時の別名重複解決の詳細UI（マージは自動。別名個数上限超過時の挙動は既存 `AliasStore` の `AliasLimitError` に委ねる）。
- HTMLインポートの重複解決（PRD 明記どおり新規作成のみ。既存重複チェックは行わない）。
