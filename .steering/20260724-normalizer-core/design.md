# 設計書

## アーキテクチャ概要

`packages/shared`（サービスレイヤー / 純粋ドメインロジック）に、正規化ロジック `Normalizer` と共有ドメイン型を追加する。ブラウザ描画・React・chrome API・DOM に依存しない純関数として実装し、vitest（U2 整備済み）で co-located テストする。上位（U6 SearchEngine, U5 AliasStore）はここを import して構築する。

```
packages/shared/lib/
├── search/
│   ├── Normalizer.ts        # ← 本単位: normalizeText / normalizeUrl / hashUrl
│   ├── Normalizer.test.ts   # ← 本単位: co-located ユニットテスト
│   └── index.ts             # ← 本単位: search バレル
├── types/
│   ├── bookmark.ts          # ← 本単位: BookmarkNode
│   ├── alias.ts             # ← 本単位: AliasRecord / AliasChunk / AliasIndex
│   ├── search.ts            # ← 本単位: SearchResultItem 系 / FolderScope
│   └── index.ts             # ← 本単位: types バレル
└── (index.mts に search/types の再エクスポートを追加)

依存方向: SearchEngine(U6) ─▶ Normalizer ; AliasStore(U5) ─▶ Normalizer(hashUrl) / types
```

## コンポーネント設計

### 1. Normalizer（`search/Normalizer.ts`）

**責務**:
- 検索語・被検索文字列・別名の同値化（`normalizeText`）。
- URL の表記ゆれ吸収（`normalizeUrl`）と、それに基づく決定的キー生成（`hashUrl`）。

**実装の要点**:
- functional-design の実装に忠実に、`class Normalizer` としてインスタンスメソッドで提供する。あわせて既定インスタンス（例: `export const normalizer = new Normalizer()`）も export し、呼び出し側の利便性と将来の注入可能性を両立する。
- `normalizeText`:
  ```
  input.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
  ```
  - NFKC で全角半角・半角カナ→全角カナを吸収 → 小文字化 → カタカナ→ひらがな。順序が重要（NFKC を先に行うことで半角カナも `ァ-ヶ` 範囲に入りひらがな化される）。
- `normalizeUrl`:
  - `new URL(raw)` でパース。`u.hash = ''`。`pathname` が `/` で終わり、かつ `/` 単体でなければ末尾スラッシュを除去。`u.search` は保持。
  - 返却は `u.protocol + '//' + u.host + u.pathname + u.search`。
  - 不正 URL（`new URL` が throw）の扱いは「エラーハンドリング戦略」参照。
- `hashUrl`:
  - `normalizeUrl` 適用後、FNV-1a(32bit) を `Math.imul` で計算し `(h >>> 0).toString(16)` を返す。同期・決定的。
- func-style（eslint: `expression`）に反しないよう、モジュール直下の補助関数はアロー関数 `const` で定義する（クラスメソッドは対象外）。

### 2. ドメイン型（`types/*.ts`）

**責務**:
- functional-design データモデルの中核型を提供し、U4〜U6 の実装の共通語彙にする。

**実装の要点**:
- `bookmark.ts`: `BookmarkNode`（`id` / `parentId?` / `title` / `url?` / `dateAdded?` / `children?`）。「id は紐付けキーに使わない」等の設計意図をコメントで残す。
- `alias.ts`: `AliasRecord`（`urlHash` / `url` / `aliases` / `updatedAt`）、`AliasChunk = Record<string, AliasRecord>`、`AliasIndex`（`chunkCount` / `hashToChunk` / `storageMode: 'sync' | 'local'`）。上限（20個・50文字）は制約コメントで明記（検証実装は U5）。
- `search.ts`: 検索結果値型（`SearchResultItem`: ブックマーク + `matchedAliases` + `score` 等）と `FolderScope`（`folderId` / サブフォルダ含む可否）。SearchEngine の詳細な内部型は U6 で拡張する前提で最小限にする。
- すべて型のみ（`interface` / `type`）。ランタイム値は持たせない。
- `@typescript-eslint/consistent-type-exports` / `consistent-type-imports` に従い、型は `export type` で公開する。

### 3. バレル / 公開 API

**実装の要点**:
- `search/index.ts` と `types/index.ts` を新設し、`packages/shared/index.mts` に `export * from './lib/search/index.js';` `export * from './lib/types/index.js';` を追加（既存の `.js` 参照規約に合わせる）。
- 既存 `shared` の tsconfig（`include: ["index.mts", "lib"]`, `exclude: ["lib/**/*.test.ts"]`）により、`Normalizer.test.ts` は build から除外され dist に流出しない（U2 整備済みの仕組みを踏襲）。

## データフロー

### 検索語の同値化（U6 が利用）
```
1. ユーザー入力 "ＧitＨｕｂ" を normalizeText → "github"
2. 被検索文字列（タイトル/別名/フォルダ名）も normalizeText
3. 同一同値クラスに寄るため部分一致が成立
```

### 別名紐付けキーの生成（U5 が利用）
```
1. 登録対象 URL "https://ex.com/a/#top" を normalizeUrl → "https://ex.com/a"
2. hashUrl で FNV-1a → "xxxxxxxx"（AliasRecord.urlHash）
3. 同一ページの表記ゆれ（末尾スラッシュ・フラグメント差）が同一 urlHash に寄る
```

## エラーハンドリング戦略

### カスタムエラークラス
- 本単位では新規エラークラスは導入しない（純粋な変換関数のため）。

### エラーハンドリングパターン
- `normalizeUrl` / `hashUrl` の入力が不正 URL の場合、`new URL()` は `TypeError` を throw する。**MVP では呼び出し側（U5 AliasStore）が有効な URL のみを渡す前提**とし、Normalizer 内では握り潰さず throw を素通しする（早期失敗）。この前提と挙動を JSDoc に明記し、テストでも「不正 URL は throw する」ことを1ケース確認する。
  - ※ ブックマークの URL は Chrome が保持する妥当な絶対 URL であり、`chrome://` 等の特殊スキームも `URL` でパース可能。過剰な防御は行わない。

## テスト戦略

### ユニットテスト（`search/Normalizer.test.ts`, co-located）
- `normalizeText`: 全角英数⇔半角、大小文字、カタカナ⇔ひらがな、半角カナ→ひらがな、混在文字列、空文字。
- `normalizeUrl`: フラグメント除去、末尾スラッシュ除去、ルート `/` 保持、クエリ保持、クエリ差の区別、host/protocol 保持。
- `hashUrl`: 決定性（同入力→同出力）、フラグメント差の同一化、クエリ差の別ハッシュ化、現実的サンプルでの非衝突、同期（`typeof result === 'string'`）。
- 異常系: `normalizeUrl('not a url')` が throw する。
- カバレッジ目標: shared 80%（本単位の Normalizer は実質 100% を狙える）。閾値 gate 化は U2 方針どおり後続。

### 統合テスト
- 本単位では対象外（SearchEngine/AliasStore と結合する U6/U5 で扱う）。

## 依存ライブラリ

- 新規追加なし。`URL` / `String.prototype.normalize` / `Math.imul` は Node/ブラウザ標準。vitest は U2 で導入済み。

## ディレクトリ構造

```
packages/shared/
  index.mts                     # search/types のバレル再エクスポートを追加
  lib/
    search/
      Normalizer.ts             # 新規
      Normalizer.test.ts        # 新規
      index.ts                  # 新規（バレル）
    types/
      bookmark.ts               # 新規
      alias.ts                  # 新規
      search.ts                 # 新規
      index.ts                  # 新規（バレル）
```

## 実装の順序

1. `types/`（bookmark.ts → alias.ts → search.ts → index.ts）を定義（後続の共通語彙を先に確定）。
2. `Normalizer.ts` を実装（normalizeText → normalizeUrl → hashUrl）。
3. `Normalizer.test.ts` を co-located で作成し、受け入れ条件の同値クラスを網羅。
4. `search/index.ts` と `index.mts` のバレルを整備し、`@extension/shared` から公開。
5. 品質チェック（`pnpm -F @extension/shared test` / 全体 `type-check` / `lint` / `build`）。

## セキュリティ考慮事項

- 外部通信ゼロ方針に整合（`fetch`/XHR/WebSocket なし）。`hashUrl` は `crypto.subtle`（非同期）を避け、ローカル同期計算のみ。
- 個人データ（URL）を外部へ出さず、ハッシュ化もローカルで完結する。

## パフォーマンス考慮事項

- `normalizeText` は正規表現1回 + 標準API。1,000 件・1文字ごと再描画（100ms 以内目標）に耐える軽量実装。
- `hashUrl` は O(URL長) の単純ループ。別名 upsert 100ms 目標に対し無視できるコスト。

## 将来の拡張性

- クエリ正規化強化（`utm_*` 除去リスト）や `hashUrl` の 64bit 化は、`normalizeUrl` / `hashUrl` の内部差し替えで後方互換に対応できる（公開シグネチャ不変）。
- ローマ字/読み推定は Normalizer ではなく別名登録側で対応する方針（Post-MVP）。
