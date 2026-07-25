# 設計書 — U6 search-engine

## アーキテクチャ概要

`SearchEngine` はサービス層（`packages/shared`）に属し、正規化（Normalizer）を用いてデータ層（BookmarkService / AliasStore）から得たデータを検索可能な **インメモリ索引** に変換し、同期の `search()` を提供する。chrome API・React・DOM には依存しない純粋ロジックとして単体テスト可能に保つ（architecture.md「UI→サービス→データ」）。

functional-design の `search(query): SearchResultItem[]` が **同期** であることを重視し、以下の 2 段構成にする:

1. **索引構築（データ統合・非同期の外縁）**: ブックマークツリー + 別名マップ → 正規化済み索引エントリ配列。
2. **検索（純粋・同期）**: 索引エントリに対して AND 部分一致 → スコアリング → ソート、0 件時のみフォールバック。

```mermaid
graph TD
    U7[U7 Popup/useSearch] -->|search query| SE[SearchEngine.search 同期]
    U7 -->|refresh| LI[SearchEngine.loadIndex 非同期]
    LI --> BS[BookmarkService.getTree]
    LI --> AS[AliasStore.getAll]
    LI --> BI[buildIndex 純粋]
    BI --> NZ[Normalizer.normalizeText / hashUrl]
    SE --> IDX[(インメモリ索引 SearchEntry[])]
    BI --> IDX
```

## コンポーネント設計

### 1. 型定義の拡張（`packages/shared/lib/types/search.ts`）

**責務**:
- functional-design の `SearchResultItem`（`node` / `folderPath` / `aliases` / `matchedAliases` / `matchedFields` / `score`）へ既存の最小定義を拡張する。
- `SearchQuery`（`keywords: string[]` / `folderScope?: FolderScope`）を追加する。
- `MatchedField = 'title' | 'folder' | 'alias'` を定義する。

**実装の要点**:
- 既存の `FolderScope` を再利用する（`SearchQuery.folderScope` の型）。
- `SearchResultItem.node` は `BookmarkNode`（`@extension/storage` 由来、既存の再エクスポート経路を踏襲）。

### 2. Levenshtein / 近似部分一致（`packages/shared/lib/search/fuzzy.ts`）

**責務**:
- 純粋関数 `approxSubstringDistance(pattern, text): number` を提供する。パターンとテキストの **任意部分文字列** との最小編集距離を返す（前方位置を自由にできる DP: 先頭行を 0 初期化し、最終行の最小値を取る）。
- しきい値判定ヘルパ `fuzzyThreshold(len): number`（len ≤ 4 → 1、≥ 5 → 2）。

**実装の要点**:
- テキスト長 × パターン長の DP。フォールバックは結果 0 件時のみ発火するため計算コストは許容範囲。
- 純粋・決定的。単体テストで距離値を直接検証する。

### 3. SearchEngine 本体（`packages/shared/lib/search/SearchEngine.ts`）

**責務**:
- 索引構築: `buildIndex(tree, aliasMap)`（純粋）/ `loadIndex(bookmarkService, aliasStore)`（非同期・薄いラッパ）。
- 検索: `search(query): SearchResultItem[]`（同期）。
- フォールバック: `private fuzzyFallback(entries, keywords): SearchResultItem[]`。

**索引エントリ（内部型 `SearchEntry`）**:
```ts
interface SearchEntry {
  node: BookmarkNode;          // url を持つブックマークのみ
  folderPath: string[];        // 上位→末端のフォルダ名（表示用）
  folderIdPath: string[];      // 祖先フォルダ ID（scope 範囲判定用）
  aliases: string[];           // 原文の別名
  nTitle: string;              // 正規化済みタイトル
  nFolders: string[];          // 正規化済みフォルダ名
  nAliases: string[];          // 正規化済み別名（aliases と同順）
}
```

**実装の要点**:
- `loadIndex` は `BookmarkService` / `AliasStore` の **具象クラスに直接依存せず**、最小構造インターフェース（`{ getTree(): Promise<BookmarkNode[]> }` / `{ getAll(): Promise<Map<string, AliasRecord>> }`）で受ける。既存 `AliasStore` の `AliasNormalizer` 注入と同じ疎結合方針（循環依存回避・テスト容易性）。
- ツリー走査: 真のルート（`parentId === undefined`）はパスに含めない。トップレベルフォルダ（「ブックマーク バー」等）以下はフォルダ名・ID をパスに積む（`BookmarkService.getFolderPath` と往復整合）。url を持つノードのみをエントリ化する。
- **フォルダ名の照合範囲（決定事項）**: `nFolders` は末端の親だけでなく **祖先フォルダ名すべて（フルパス）** を保持する。したがってフォルダ名で検索すると、そのフォルダ配下の直下ブックマークに加え **ネストした子孫（孫・ひ孫）も含めてヒット**する（サブツリー全体）。folder は基礎点 4（最低）かつ AND 条件のため、共通の上位フォルダ名（例:「ブックマーク バー」）で広くヒットしても順位・実害は限定的。これはキーワード照合としての弱いシグナルであり、明示的な範囲絞り込みは folderScope（機能5）が担う。
- 別名紐付け: `normalizer.hashUrl(url)` で aliasMap を引く。`hashUrl` が不正 URL で throw した場合はそのエントリの別名を空として続行（索引構築全体を落とさない・防御的）。
- 正規化はビルド時に一度だけ実施し、検索時はキーワード側のみ正規化する（性能）。

## データフロー

### 検索（同期）
```
1. query.keywords を normalizeText で正規化し、空要素を除外 → kw[]
2. kw が空なら「ブラウズ」: folderScope でフィルタした全エントリを score=0・title 昇順で返す
3. 各エントリについて、folderScope 範囲判定 → 範囲外は除外
4. 各キーワードごとに title/folder/alias の一致を評価:
   - substring 判定（normalizeText 済み同士）
   - 位置ボーナス: 完全一致 +5 / 前方一致 +3 / 部分一致 +0
   - 基礎点: title 10 / alias 8 / folder 4 → キーワード単位で max(基礎点+ボーナス)
5. 全キーワードが一致（AND）したエントリのみ通過。score 合算、matchedFields/matchedAliases 収集
6. score 降順・同点は title 昇順で安定ソート
7. 結果が 0 件なら fuzzyFallback を実行
```

### folderScope 範囲判定
```
- includeSubfolders=true: folderScope.folderId ∈ entry.folderIdPath
- includeSubfolders=false: entry.node.parentId === folderScope.folderId
- フォルダ名に '/' が含まれても ID で判定するため影響しない
```

### フォールバック（0 件時のみ）
```
1. 各エントリの候補文字列群 = [nTitle, ...nFolders, ...nAliases]
2. 各キーワードについて、いずれかの候補との approxSubstringDistance が
   fuzzyThreshold(keyword長) 以下なら「近似一致」
3. 全キーワードが近似一致したエントリのみ通過（AND 維持）
4. score = 負の総距離（距離が小さいほど上位）、matchedFields/matchedAliases も近似一致で収集
5. score 降順・同点 title 昇順で安定ソート
```

## エラーハンドリング戦略

### カスタムエラークラス
- 新規のカスタムエラーは追加しない（検索は失敗ではなく「0 件」で表現する）。

### エラーハンドリングパターン
- `hashUrl` の URL パース失敗（不正 URL のブックマーク）は索引構築時に try/catch し、当該エントリの別名を空として続行する（`console.warn` で記録）。索引全体を巻き込まない。
- 検索入力が空・空白のみの場合は例外にせずブラウズ結果（または空）を返す。

## テスト戦略

### ユニットテスト（`SearchEngine.test.ts` / `fuzzy.test.ts`）
- 正規化 AND 部分一致: 全角半角・大小文字・かな/カナのゆれで同一ヒット。複数語 AND で絞り込み。
- 照合フィールド: タイトル / フォルダ名 / 別名 それぞれ単独でヒットすること。
- matchedAliases / matchedFields: ヒットした別名・フィールドが正しく付与される。
- folderScope: includeSubfolders true/false の差、`/` を含むフォルダ名でも壊れない、scope が照合対象に入らない。
- スコアリング: 完全一致 > 前方一致 > 部分一致、タイトル > 別名 > フォルダの序列、同点 title 昇順。
- フォールバック: ヒット時は非発火、0 件時のみ発火、しきい値（≤4→1 / ≥5→2）境界。
- fuzzy: `approxSubstringDistance` の距離値、`fuzzyThreshold` の境界。
- 索引: フォルダは結果に出ない、別名が urlHash で正しく紐付く、不正 URL のブックマークで落ちない。

### 統合テスト
- 実際の `Normalizer` を注入した `SearchEngine` で、別名付与 → 検索ヒット → matchedAlias 付与の一連（functional-design のシーケンス相当）を確認。

## 依存ライブラリ

新規の外部ライブラリは追加しない（Levenshtein は自前実装。functional-design「フォールバックのあいまい一致のみ軽量ライブラリを検討」に対し、MVP では依存を増やさず自前 DP とする）。

## ディレクトリ構造

```
packages/shared/lib/
├── types/
│   └── search.ts            # SearchQuery / SearchResultItem 拡張 / MatchedField 追加
└── search/
    ├── SearchEngine.ts      # 新規: SearchEngine 本体
    ├── SearchEngine.test.ts # 新規
    ├── fuzzy.ts             # 新規: approxSubstringDistance / fuzzyThreshold
    ├── fuzzy.test.ts        # 新規
    ├── Normalizer.ts        # 既存
    └── index.ts             # SearchEngine / fuzzy を再エクスポート
```

## 実装の順序

1. 型定義の拡張（`types/search.ts`）。
2. `fuzzy.ts`（Levenshtein 近似部分一致）＋テスト。
3. `SearchEngine.ts`（索引構築 → 検索 → スコア → ソート → フォールバック）。
4. `index.ts` エクスポート追加。
5. `SearchEngine.test.ts` で受け入れ条件を網羅。
6. 品質ゲート（test / lint / type-check）。

## セキュリティ考慮事項

- 外部通信ゼロを維持（`fetch`/XHR/WebSocket を一切使わない）。索引はメモリ内のみ。
- 別名紐付けキーは URL 正規化ハッシュ（既存 Normalizer）で、chrome の可変 ID に依存しない。

## パフォーマンス考慮事項

- 正規化はビルド時に一度だけ実施し、検索は同期・O(件数 × キーワード数 × フィールド数) の substring 判定に抑える（1,000 件で 1 文字 100ms 以内の前提）。
- Levenshtein DP はコストが高いため、**結果 0 件時のみ** 実行する（発火頻度を最小化）。

## 将来の拡張性

- スコア係数・位置ボーナスは定数として集約し、frecency など将来のシグナル追加を容易にする。
- 索引の増分更新（ブックマーク変更イベント購読）は U7 以降で UI 側から `loadIndex`/`buildIndex` を再呼び出しする形で対応可能な構造とする。
