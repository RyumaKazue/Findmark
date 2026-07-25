# 要求内容 — U6 search-engine

## 概要

ブックマーク全件と別名（AliasRecord）を対象に、正規化した検索語で「タイトル + フォルダ名 + 別名」を **AND 部分一致** 照合し、マッチ理由（`matchedAliases` / `matchedFields`）とスコアを付与して関連度順に返す `SearchEngine` を実装する。結果 0 件時のみ Levenshtein ベースのあいまい一致（フォールバック）を発火させる。

## 背景

Findmark の中核価値「自分だけの別名で数秒で引ける検索」を成立させる検索ロジック本体。U3(Normalizer) の正規化、U4(BookmarkService) のブックマークツリー、U5(AliasStore) の別名を統合し、UI（U7 popup-search-shell）が同期的に呼べる純粋な検索エンジンを提供する。1,000 件で 1 文字あたり再描画 100ms 以内という性能要件のため、検索は **事前構築したインメモリ索引に対する同期処理** とする。

- 引用元:
  - PRD 機能2「検索マッチング(正規化)」（`docs/product-requirements.md` L114-125）
  - functional-design「SearchEngine(検索・マッチング)」（`docs/functional-design.md` L228-261）
  - functional-design「検索スコアリングとマッチング」アルゴリズム（`docs/functional-design.md` L585-631）
  - architecture.md レイヤー依存「UI → サービス → データ」（SearchEngine はサービス層）

## 実装対象の機能

### 1. SearchEngine 本体（正規化 AND 部分一致）
- スペース区切りの複数キーワードを **AND** 条件で部分一致検索する。
- 検索語・被検索文字列の両方に `Normalizer.normalizeText`（NFKC・小文字化・カナ統一）を適用して照合する。
- 照合対象は「タイトル + フォルダ名 + 別名」の 3 フィールド。
- 各項目に `matchedAliases`（ヒットした別名）と `matchedFields`（`'title'|'folder'|'alias'`）を付与する。

### 2. フォルダ絞り込み（folderScope）の範囲適用
- `folderScope`（`folderId` / `includeSubfolders`）は **照合対象から除外** し、範囲フィルタとしてのみ適用する。
- `includeSubfolders=true` なら対象フォルダ配下（サブフォルダ含む）、`false` なら直下のみに絞る。

### 3. スコアリングと安定ソート
- フィールド基礎点（タイトル=10 / 別名=8 / フォルダ名=4）＋位置ボーナス（完全一致=+5 / 前方一致=+3 / 部分一致=+0）で、キーワード単位に最大点を採用し合算する。
- スコア降順、同点はタイトル昇順で安定ソートする。

### 4. フォールバック（結果 0 件時のみ）
- 通常検索の結果が 0 件のときだけ Levenshtein ベースのあいまい一致を発火する。
- しきい値: キーワード長 ≤ 4 は編集距離 1 まで、5 文字以上は距離 2 まで許容。AND 条件（全キーワードがいずれかのフィールドに近似一致）を維持する。
- 辞書は同梱しない（ローマ字・読みがな一致は別名登録で対応する方針）。

### 5. 索引構築とデータ統合
- ブックマークツリー（`BookmarkNode[]`）と別名マップ（`Map<urlHash, AliasRecord>`）から検索索引を構築する。
- 別名は `Normalizer.hashUrl(url)` で算出したキーでブックマークに紐付ける。
- フォルダ（url を持たないノード）は結果から除外し、フォルダ名は照合・`folderPath` 表示に使う。

## 受け入れ条件

> 出典: `docs/mvp-development-flow.md` U6 行「受け入れ基準」＝ PRD 機能2 / functional-design。

### AND 部分一致（PRD 機能2 / functional-design ステップ2）
- [x] スペース区切りの複数ワードが AND 条件で部分一致検索される。
- [x] 検索語・被検索文字列の両方に正規化が適用され、全角半角・大小文字・ひらがな/カタカナの表記ゆれが同値化される。
- [x] 「タイトル / フォルダ名 / 別名」のいずれかに部分一致すれば当該キーワードが一致とみなされる。
- [x] フォルダ名照合はサブツリー全体を対象とする（フォルダ名で検索すると直下＋ネストした子孫のブックマークもヒットする。祖先フォルダ名すべてを照合対象にする）。

### マッチ別名の付与（functional-design ステップ3）
- [x] ヒットした別名が `matchedAliases` に記録される（表示で先頭ハイライトする用途）。
- [x] `matchedFields` に一致フィールド（`title`/`folder`/`alias`）が記録される。

### folderScope 除外（functional-design ステップ2）
- [x] `folderScope` は照合対象に含まれず、範囲フィルタとしてのみ適用される。
- [x] `includeSubfolders` の true/false で配下含む/直下のみが切り替わる。
- [x] フォルダパスに `/` を含む名前があっても壊れない（ID ベースで範囲判定するため）。

### スコアリングと安定ソート（functional-design ステップ3）
- [x] スコアがフィールド基礎点＋位置ボーナスの規定どおり算出される。
- [x] スコア降順・同点タイトル昇順で安定ソートされる。

### フォールバック（functional-design ステップ4）
- [x] 通常検索が 1 件以上ヒットするときはフォールバックが発火しない。
- [x] 結果 0 件時のみあいまい一致が発火し、しきい値（≤4→距離1 / ≥5→距離2）に従う。

### 品質ゲート
- [x] `pnpm test`（shared パッケージ）でユニットテストがパスする。
- [x] `pnpm lint` / `pnpm type-check` がパスする。

## 成功指標

- 上記受け入れ条件をユニットテストで機械的に担保する（UI なしで検証可能）。
- 検索処理が同期関数として提供され、U7（popup）がキーストロークごとに呼べる（性能要件 100ms/文字の前提）。

## スコープ外

以下はこのフェーズでは実装しません:

- Popup UI（`useSearch` フック・ResultList 等）→ U7。
- 索引の自動再構築トリガ（ブックマーク変更イベント購読）→ U7 以降で UI 側が制御。
- frecency ソート / タグ / 未ヒット時の別名登録提案（Post-MVP）。
- ローマ字→かな変換・漢字読み推定（辞書非同梱方針）。

## 参照ドキュメント

- `docs/product-requirements.md` L114-125 - PRD 機能2 検索マッチング(正規化)
- `docs/functional-design.md` L228-261 / L585-631 - SearchEngine コンポーネント設計・アルゴリズム
- `docs/architecture.md` - レイヤー依存（UI→サービス→データ）
- `docs/mvp-development-flow.md` U6 行 - 受け入れ基準の出典
