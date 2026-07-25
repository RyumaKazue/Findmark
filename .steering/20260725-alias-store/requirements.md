# 要求内容 — U5 alias-store

## 概要

別名（エイリアス）の永続化を担う `AliasStore` を `packages/storage`（データレイヤー）に実装する。`chrome.storage.sync` の「1アイテム8KB / 最大512アイテム」制限を回避するチャンク分割保存（`alias_chunk_N` + 逆引き `alias_index`）、sync 容量超過時の local フォールバック、正規化・重複排除・上限検証を内包した CRUD（`getByUrl` / `getAll` / `upsert` / `merge` / `remove`）を提供する。

## 背景

Findmark の中核価値「自分だけの別名で数秒で引ける検索」「別名ごと持ち運べる移行」を支えるデータ基盤。別名はブックマークの Chrome 採番 ID ではなく **URL 正規化ハッシュ（`urlHash`）** で紐付けるため、端末/アカウント移行でも別名が外れない（PRD「移行しても別名が外れない」）。上位の U6 SearchEngine（`getAll` で別名を引く）、U9 AliasEditor（`upsert`）、U15 ImportExport（`merge`）、U16 Trash / U17 ServiceWorker が本 Store に依存する。

- 引用元: PRD 機能3「別名(エイリアス)の登録・編集」（`docs/product-requirements.md`）
- 引用元: `docs/functional-design.md`「エンティティ: AliasRecord」「ストレージ上の格納形式: AliasChunk」「AliasStore(別名の永続化)」
- 依存単位: U3 normalizer-core（`Normalizer.normalizeText` / `normalizeUrl` / `hashUrl`）✅ 完了

## 実装対象の機能

### 1. AliasStore クラス（`packages/storage/lib/impl/aliasStore.ts`）
- `getByUrl(url): Promise<AliasRecord | null>` — URL を正規化ハッシュ化し、該当チャンクから 1 件取得。
- `getAll(): Promise<Map<string /* urlHash */, AliasRecord>>` — 全チャンクを結合して返す。
- `upsert(url, aliases): Promise<void>` — 正規化・重複排除・上限検証を内包して登録/更新。
- `merge(url, incoming): Promise<AliasRecord>` — 既存別名と `incoming` を和集合マージ（インポート用）。
- `remove(url): Promise<void>` — 該当レコードを削除し逆引きインデックスを更新。

### 2. チャンク分割保存（`alias_chunk_N` + `alias_index`）
- レコードは `alias_chunk_0`, `alias_chunk_1`, ... に `urlHash → AliasRecord` のマップとして格納。
- **バイト長ベース**で分割判定する（`JSON.stringify(chunk)` の UTF-8 バイト長が安全閾値 7KB を超えたら新チャンクへ切り出す）。「100件」は初期見積り用の目安値。
- `alias_index`（`chunkCount` / `hashToChunk` / `storageMode`）で対象チャンクのみを更新できるようにする。

### 3. sync → local フォールバック
- `chrome.storage.sync.set` が容量超過（quota exceeded）で失敗したら、全データ（index + 全チャンク）を `chrome.storage.local` へ退避し、`storageMode` を `'local'` に切り替える。以後は local を使用する。

### 4. 上限検証・重複排除・エラー型
- `aliases` は最大 20 個、各要素は最大 50 文字。超過時は `AliasLimitError`（`limit` と `kind: 'count' | 'length'` を保持）を throw。
- 別名比較は必ず `Normalizer.normalizeText` を通し、正規化後に重複する別名を排除する（生文字列比較禁止）。
- **レイヤー遵守**: `packages/storage` は `packages/shared` に依存できない（循環禁止）。Normalizer は **依存注入（DI）** で受け取る。

## 受け入れ条件

> 出典: `docs/mvp-development-flow.md` U5 行「受け入れ基準」＝「100件境界でチャンク分割 / 上限超過で AliasLimitError / sync容量超過でlocal退避」。PRD 機能3 の該当条件も併記。

### チャンク分割保存
- [ ] レコードを追加していきチャンクのバイト長が閾値（7KB）を超えると、新しいチャンク（`alias_chunk_1` ...）に切り出される（`alias_index.chunkCount` が増える）。
- [ ] `alias_index.hashToChunk` により、対象 `urlHash` が属するチャンクだけを読み書きできる。
- [ ] `getAll()` が全チャンクを結合して全レコードを返す。

### 上限検証・重複排除（PRD 機能3）
- [ ] `upsert` / `merge` で別名が 21 個以上になると `AliasLimitError`（`kind='count'`, `limit=20`）を throw する。
- [ ] 51 文字以上の別名を与えると `AliasLimitError`（`kind='length'`, `limit=50`）を throw する。
- [ ] 正規化（NFKC + 小文字化 + カナ統一）後に等しい別名は重複として自動排除される（例: `Docs` と `ＤＯＣＳ`）。

### sync → local フォールバック
- [ ] `chrome.storage.sync.set` が容量超過で失敗すると、既存データを local へ退避し `storageMode='local'` になる。
- [ ] フォールバック後の読み書きが local に対して行われ、データが失われない。

### CRUD 基本動作
- [ ] `upsert` 後に `getByUrl(sameUrl)` が登録した別名（正規化済み・重複排除済み）を返す。
- [ ] 表記ゆれ URL（末尾スラッシュ / フラグメント差）でも同一レコードに解決される（`Normalizer.hashUrl` 経由）。
- [ ] `remove` 後に `getByUrl` が `null` を返し、`getAll` にも含まれない。

## 成功指標

- 別名 upsert が 100ms 以内（PRD 非機能: 別名 upsert 100ms 以内）。単一チャンクの読み書きに閉じる設計で満たす。
- `packages/storage` のユニットテストカバレッジ 80% 以上（U2 で保留していた `coverage.thresholds` を本単位で有効化）。

## スコープ外

以下はこのフェーズでは実装しません:

- 別名編集 UI（チップ UI・点滅・ハイライト） → U9 alias-editor
- SearchEngine による別名マッチ・ハイライト付与 → U6 search-engine
- インポート/エクスポートの重複解決フロー（`merge` の呼び出し側） → U15 import-export
- ゴミ箱・Service Worker の孤立参照掃除 → U16 / U17
- 別名のマイグレーション（スキーマ version 変換）。本単位は現行スキーマのみ。

## 参照ドキュメント

- `docs/product-requirements.md` — 機能3「別名(エイリアス)の登録・編集」
- `docs/functional-design.md` — 「AliasRecord」「AliasChunk」「AliasStore」節
- `docs/architecture.md` / `docs/repository-structure.md` — レイヤー依存（UI→サービス→データ）・循環依存の禁止
- `docs/development-guidelines.md` — エラーハンドリング（`AliasLimitError`）・テスト命名規則
- `docs/mvp-development-flow.md` — U5 alias-store 行
