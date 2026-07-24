# 要求内容

## 概要

検索・別名照合・URL 紐付けの土台となる **Normalizer**（`normalizeText` / `normalizeUrl` / `hashUrl`）と、共有ドメイン型を `packages/shared` に実装する。ブラウザ描画・React に依存しない純粋ロジックとして、ユニットテスト（vitest, U2 で整備済み）付きで完成させる。これは MVP 機能2（検索マッチングの正規化）の中核であり、後続の U5（AliasStore）・U6（SearchEngine）が依存する基盤（作業単位 U3）である。

## 背景

- 本作業は [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) の作業単位 **U3 (normalizer-core)** に対応する（依存: U2 = 完了済み）。
- [docs/functional-design.md](../../docs/functional-design.md) が Normalizer の責務と実装方針を定義している:
  - `normalizeText`: NFKC → 小文字化 → カタカナ→ひらがな統一（全角半角/カナ/大小文字を同値化）
  - `normalizeUrl`: フラグメント除去・末尾スラッシュ正規化（クエリは保持）
  - `hashUrl`: `normalizeUrl` の結果を **FNV-1a（同期ハッシュ）** でハッシュ化（`crypto.subtle.digest` は非同期のため不採用）
- URL ベースのハッシュを別名の紐付けキー（`AliasRecord.urlHash`）にすることで、Chrome 採番 ID に依存せず、端末/アカウントをまたいでも別名が外れない（移行に強い）設計を担保する。
- Normalizer はドメインロジック層の最下層に近く、UI が chrome API / DOM を直接触らない[docs/architecture.md](../../docs/architecture.md)のレイヤー依存（UI→サービス→データ）の起点となる。

## 実装対象の機能

### 1. Normalizer（`packages/shared/lib/search/Normalizer.ts`）
- **`normalizeText(input: string): string`**: `NFKC` 正規化 → `toLowerCase()` → カタカナ（`ァ-ヶ`）をひらがなへ変換。検索語・被検索文字列・別名の比較に用いる同値化関数。
- **`normalizeUrl(raw: string): string`**: `URL` でパースし、`hash` 除去、末尾スラッシュ正規化（`/` 単体は保持）、`search`（クエリ）は保持。`protocol//host+pathname+search` を返す。
- **`hashUrl(url: string): string`**: `normalizeUrl` の結果を FNV-1a（32bit）で走査し、符号なし16進文字列を返す（同期）。

### 2. 共有ドメイン型（`packages/shared/lib/types/`）
- functional-design 「データモデル」の中核エンティティ／値型を型定義として整備し、U4〜U6 が import できるようにする。少なくとも以下を含む:
  - `BookmarkNode`（Chrome ブックマークツリーのノード）
  - `AliasRecord` / `AliasChunk` / `AliasIndex`（別名レコードと sync 格納形式）
  - 検索結果の値型（`SearchResultItem` 等、SearchEngine が返す形）と `FolderScope`（絞り込み）
- 型のみ（ランタイムコードなし）とし、実装（AliasStore/SearchEngine 本体）は各担当作業単位（U5/U6）で行う。
- `packages/shared/index.mts` からバレルで再エクスポートし、`@extension/shared` 経由で参照可能にする。

## 受け入れ条件

### normalizeText
- [ ] 全角英数と半角英数が同値化される（例: `ＡＢＣ123` ⇔ `abc123`）
- [ ] 大文字小文字が同値化される（例: `GitHub` ⇔ `github`）
- [ ] カタカナとひらがなが同値化される（例: `ギットハブ` ⇔ `ぎっとはぶ`）
- [ ] 半角カナが NFKC 経由で全角化され、さらにひらがなへ同値化される（例: `ｷﾞｯﾄ` ⇔ `ぎっと`）
- [ ] 同値クラスがユニットテストで担保される

### normalizeUrl
- [ ] フラグメント（`#...`）が除去される
- [ ] 末尾スラッシュが正規化される（`.../path/` → `.../path`）。ただしルート `/` 単体は保持する
- [ ] クエリ（`?...`）は保持され、異なるクエリは別 URL として区別される
- [ ] URL 正規化の同値クラス（同一ページを指す表記ゆれが同一結果に寄る）がテストで担保される

### hashUrl
- [ ] 同一の正規化 URL からは常に同一ハッシュが得られる（決定的）
- [ ] 異なる正規化 URL からは異なるハッシュが得られる（現実的なサンプルで衝突しない）
- [ ] 同期関数である（Promise を返さない）
- [ ] フラグメントだけ異なる URL が同一ハッシュに寄る／クエリが異なる URL は別ハッシュになる

### ドメイン型
- [ ] `BookmarkNode` / `AliasRecord` / `AliasChunk` / `AliasIndex` / 検索結果値型 / `FolderScope` が `packages/shared/lib/types/` に定義されている
- [ ] `@extension/shared` から型が import できる（バレル再エクスポート）
- [ ] functional-design のデータモデル（フィールド名・型・制約コメント）と整合する

### 品質ゲート
- [ ] `pnpm -F @extension/shared test` で Normalizer のユニットテストがパスする
- [ ] `pnpm type-check` / `pnpm lint` / `pnpm build` がエラーなく通る

## 成功指標
- 全角半角/カナ/大小文字を吸収した検索照合の同値化が、テストで保証された状態になる。
- URL の表記ゆれを吸収した決定的なキー（`urlHash`）生成が可能になり、U5（AliasStore）の紐付けキー生成の前提が整う。
- 純粋関数として単体テスト可能（chrome API / DOM 非依存）であることが担保される。

## スコープ外

以下はこのフェーズでは実装しません:

- SearchEngine 本体（AND 部分一致・スコアリング・Levenshtein フォールバック）: U6
- AliasStore 本体（チャンク分割・sync/local フォールバック・upsert/merge）: U5
- BookmarkService（chrome.bookmarks/tabs ラッパ）: U4
- ローマ字→かな変換 / 漢字読み推定（辞書同梱）: Post-MVP（スコープ外）
- トラッキングパラメータ（`utm_*` 等）除去などのクエリ正規化強化: 将来拡張（functional-design 明記）

## 未確定の論点（承認前に判断が必要）

- **Normalizer の実装形態**: functional-design は `class Normalizer { normalizeText... }` を示すが、状態を持たない純粋関数群である。**「`class Normalizer`（インスタンスメソッド）として実装し、既定インスタンスも export する」**方針を推奨（functional-design の記述に忠実。SearchEngine 等からは注入も直接利用も可能）。純関数モジュール（`camelCase` 関数の集合）で実装する案もあるが、repository-structure が `Normalizer.ts`(PascalCase=クラス/サービス)として位置づけているためクラス採用を推奨。
- **ドメイン型の網羅範囲**: U3 で `types/` に定義する型を「functional-design データモデルの中核（BookmarkNode / AliasRecord 系 / 検索結果値型 / FolderScope）」に限定し、各実装の詳細な補助型は担当単位（U5/U6）で追加する方針を推奨。過不足があれば本ゲートで調整する。
- **`hashUrl` のビット幅**: functional-design は「FNV-1a 32/64bit を採用」と幅に幅を持たせている。MVP 規模（1,000 件程度）では **32bit で十分**（衝突確率が実用上無視できる）と判断し 32bit を推奨。将来的に件数が増えた場合の 64bit 化は後続で検討。

## 参照ドキュメント

- [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) - MVP開発フロー（作業単位 U3）
- [docs/functional-design.md](../../docs/functional-design.md) - Normalizer 責務 / normalizeText・normalizeUrl・hashUrl 実装 / データモデル
- [docs/architecture.md](../../docs/architecture.md) - レイヤー依存（UI→サービス→データ）・純粋ドメインロジックの単体テスト方針
- [docs/repository-structure.md](../../docs/repository-structure.md) - `packages/shared/lib/search/` `types/` の配置・命名規則
- [docs/glossary.md](../../docs/glossary.md) - 正規化 / 別名 / urlHash 等の用語定義
