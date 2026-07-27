# 設計書 — U6a search-scope-revision

## アーキテクチャ概要

既存の U6 SearchEngine の構造は維持し、**範囲フィルタの判定ロジックのみを縮退させる**。新しい抽象・レイヤーは導入しない。レイヤー依存（UI → サービス → データ）も変更なし。

```
pages/popup/src/hooks/useSearch.ts        [UI層]
  └ searchEngine.search({ keywords, folderScope })
        │  folderScope: { folderId } | undefined      ← includeSubfolders を削除
        ▼
packages/shared/lib/search/SearchEngine.ts [サービス層]
  └ search()
       └ entries.filter(entry => inScope(entry, query.folderScope))
              │
              ├ scope === undefined  → true（全件＝「すべて」）
              └ scope !== undefined  → entry.node.parentId === scope.folderId（直下のみ）
```

**変更の本質**: `inScope()` は既に「直下のみ」の分岐を持っている（`entry.node.parentId === scope.folderId`）。本単位は `includeSubfolders` による分岐を取り除き、その既存パスへ一本化するだけである。新規ロジックの追加は発生しない。

## コンポーネント設計

### 1. `FolderScope` 型（`packages/shared/lib/types/search.ts`）

**責務**:
- 検索の範囲フィルタ指定を表現する。

**変更内容**:

```ts
// 変更前
export interface FolderScope {
  folderId: string;
  includeSubfolders: boolean;   // ← 削除
}

// 変更後
export interface FolderScope {
  /** スコープ対象フォルダの ID（ID で保持する。フォルダ名に "/" を含んでも壊れない）。 */
  folderId: string;
}
```

**実装の要点**:
- `SearchQuery.folderScope` の JSDoc も「フォルダチップによる絞り込み」→「フォルダスコープ。未指定は『すべて』＝全件、指定時は直下のみ」に是正する。
- **型を残す判断**: プロパティが1つでも `FolderScope` という名前付き型は維持する。呼び出し側の可読性と、将来の拡張余地（U11 でのスコープ表現）を確保するため。

### 2. `SearchEngine.inScope`（`packages/shared/lib/search/SearchEngine.ts`）

**責務**:
- 索引エントリが現在のスコープ範囲に含まれるかを判定する。

**変更内容**:

```ts
// 変更前
private inScope(entry: SearchEntry, scope: FolderScope | undefined): boolean {
  if (!scope) return true;
  if (scope.includeSubfolders) return entry.folderIdPath.includes(scope.folderId);
  return entry.node.parentId === scope.folderId;
}

// 変更後
private inScope(entry: SearchEntry, scope: FolderScope | undefined): boolean {
  if (!scope) return true;                          // 「すべて」＝全件
  return entry.node.parentId === scope.folderId;    // 直下のみ
}
```

**実装の要点**:
- `SearchEntry.folderIdPath` は **削除しない**。祖先フォルダ名の照合（`nFolders`）と `folderPath` 表示で引き続き使われているため。`inScope` から参照されなくなるだけである。
  - → 実装時に `folderIdPath` が完全に未使用にならないことを確認する（未使用なら lint が検知する）。
- `search()` 本体・スコアリング・フォールバック・索引構築には手を入れない。
- 空クエリのブラウズ分岐（`sortResults(scoped.map(toBrowseItem))`）はそのまま。**並び順（タイトル昇順）は変更しない。**

### 3. `useSearch`（`pages/popup/src/hooks/useSearch.ts`）

**責務**:
- クエリとフォルダ選択から `SearchQuery` を組み立て、debounce 後に同期検索を実行する。

**変更内容**:

```ts
// 変更前
const folderScope = folderId ? { folderId, includeSubfolders: true } : undefined;

// 変更後
const folderScope = folderId ? { folderId } : undefined;
```

**実装の要点**:
- `folderId === null` が「すべて」を表す現在の表現をそのまま維持する（U11 でスコープ状態として明示化する）。
- フック冒頭の JSDoc「`folderId` が指定されると、そのフォルダ配下（サブフォルダ含む）に絞り込む」「検索ボックスへのフォルダチップ挿入・直下トグル・ツリー⇄チップ同期は U11」を新仕様へ是正する。

## データフロー

### スコープ指定あり（フォルダ選択中）
```
1. 左ペインで📎ボタン押下 → Popup が selectedFolderId を更新
2. useSearch が folderScope = { folderId } を組み立てる
3. SearchEngine.search() が entries を inScope でフィルタ
4. entry.node.parentId === folderId の項目のみ通過（直下のみ）
5. キーワードがあれば AND 部分一致 → スコア降順、なければタイトル昇順で返す
```

### スコープ指定なし（「すべて」）
```
1. selectedFolderId が null
2. useSearch が folderScope = undefined を渡す
3. inScope が常に true → 全ブックマークが対象
4. キーワードがあれば AND 部分一致、なければ全件をタイトル昇順で返す
```

## エラーハンドリング戦略

### カスタムエラークラス
新規に定義するものはない。

### エラーハンドリングパターン
本単位は分岐の削除のみであり、新たな失敗経路を生まない。既存の防御的処理はそのまま維持する:
- 不正 URL のブックマークで索引構築を落とさない（`lookupAliases` の try/catch）
- `hashUrl` が throw する URL は別名紐付けをスキップする

## テスト戦略

### ユニットテスト（`packages/shared/lib/search/SearchEngine.test.ts`）

既存フィクスチャ（`mainTree`）をそのまま使う。構造の要点:

```
ブックマーク バー(id:1)
 ├ GitHub(id:10)
 ├ 開発(id:2)
 │  ├ Chrome拡張のドキュメント(id:11)     ← 開発の直下
 │  └ chrome(id:3)
 │     └ Extension API Reference(id:12)  ← 開発の孫（直下ではない）
 ├ 料理(id:4) └ Cooking Recipe Site(id:13)
 ├ A/B(id:5)  └ Slash Folder Test(id:14)   ※ "/" を含むフォルダ名
 └ Invalid URL Bookmark(id:15)
```

**書き換える既存テスト（4件）**:

| 現在 | 変更後 |
|---|---|
| `includeSubfolders=true でサブフォルダ配下も範囲に含める` → `['11','12']` | **削除し、下記「含まれない」テストへ置換** |
| `includeSubfolders=false で直下のみに絞る` → `['11']` | `folderScope: { folderId: '2' }` → `['11']`（フラグを落とすだけ） |
| `フォルダ名に "/" を含んでいても範囲フィルタが壊れない` → `['14']` | `folderScope: { folderId: '5' }` → `['14']`（フラグを落とすだけ） |
| `folderScope は照合対象に含まれない` → `[]` | `folderScope: { folderId: '2' }` に変更（期待値 `[]` は不変） |

**追加テスト（2件）**:
- `サブフォルダ配下は範囲に含まれない`: `folderScope: { folderId: '2' }` の結果に `'12'`（孫）が含まれないことを検証。旧仕様との差分を明示的に固定する。
- `folderScope 未指定なら全ブックマークが対象になる`: `search({ keywords: [] })` が全ブックマーク（フォルダを除く）を返すことを検証。

**回帰確認（既存のまま通ること）**:
- AND 部分一致 / 正規化（NFKC・カナ・大小文字）
- `matchedAliases` / `matchedFields` の付与
- スコアリング（完全一致 > 前方一致 > 部分一致）、同点タイトル昇順
- 0 件時のみの Levenshtein フォールバック

### 統合テスト
本単位では追加しない。UI 経由のスコープ操作は U8a / U11 で扱う。

## 依存ライブラリ

新規追加なし。

## ディレクトリ構造

```
packages/shared/lib/types/search.ts              [変更] FolderScope から includeSubfolders 削除、JSDoc 是正
packages/shared/lib/search/SearchEngine.ts       [変更] inScope の分岐削除
packages/shared/lib/search/SearchEngine.test.ts  [変更] 既存4テスト是正 + 2テスト追加
pages/popup/src/hooks/useSearch.ts               [変更] 呼び出し側の追随、JSDoc 是正
```

新規ファイルの作成はない。

## 実装の順序

1. `packages/shared/lib/types/search.ts` — `FolderScope` から `includeSubfolders` を削除し JSDoc を是正
2. `packages/shared/lib/search/SearchEngine.ts` — `inScope` の分岐を削除（1 の型変更で型エラーが出る箇所を潰す形になる）
3. `pages/popup/src/hooks/useSearch.ts` — 呼び出し側を追随、JSDoc を是正
4. `packages/shared/lib/search/SearchEngine.test.ts` — 既存4テストの是正 + 2テストの追加
5. `pnpm test` / `pnpm lint` / `pnpm type-check` で検証

> 型 → 実装 → 呼び出し側 → テストの順にすることで、型エラーが修正漏れの検出器として働く。

## セキュリティ考慮事項

- 本単位に外部通信・権限・ストレージへの変更はない。外部通信ゼロ・最小権限の方針に影響しない。

## パフォーマンス考慮事項

- `inScope` の判定が `folderIdPath.includes()`（線形探索）から `parentId` の等値比較のみになるため、**スコープ指定時の絞り込みはむしろ軽くなる**。
- PRD の性能要件（1,000 件で 1 文字あたり再描画 100ms 以内）に対して悪化要因はない。

## 将来の拡張性

- `FolderScope` を名前付き型として残すため、U11 で「すべて」を明示的に表現する場合や、将来サブフォルダ含む指定が再び必要になった場合も、型の拡張で対応できる。
- ただし現行の仕様決定（「直下のみ」か「すべて」かの2択）は PRD 機能5 で確定済みであり、安易に再導入しない。再導入する場合は PRD から改訂する。
