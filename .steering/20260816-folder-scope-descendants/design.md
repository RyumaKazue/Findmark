# 設計書 — folder-scope-descendants

## アーキテクチャ概要

変更は**検索レイヤー（`packages/shared`）に閉じる**。UI（Popup / ResultList）は `SearchEngine.search` の結果をそのまま描画しているため、スコープの意味と並びを engine 内で変えるだけで表示が追従する。UI 側の変更はメタ行の文言のみ。

```
SearchEngine.buildIndex   ── 索引エントリに「フォルダ ID のパス」を追加
        │
SearchEngine.inScope      ── 直下判定 → 祖先判定（ID）
        │
SearchEngine.search       ── ブラウズ時のみ「直下 → それ以外」の2グループで並べる
        │
（UI は変更なし。resultMetaModel / i18n の文言だけ改訂）
```

## コンポーネント設計

### 1. `packages/shared/lib/search/SearchEngine.ts`（中心）

#### (a) 索引エントリに ID パスを持たせる

現在の `SearchEntry` は `folderPath: string[]`（**フォルダ名**の配列）しか持たない。祖先判定を**名前**で行うと、同名フォルダが別階層にあるときに取り違える（`開発/資料` と `記事/資料` が区別できない）。フォルダ名に `/` を含んでも壊れないよう ID で持つ、という既存方針（PRD 機能5）とも一致するため、**ID の配列を併せて保持する**。

```ts
interface SearchEntry {
  node: BookmarkNode;
  folderPath: string[];      // 既存（表示用のフォルダ名）
  /** 上位→末端のフォルダ ID（スコープ判定用。真のルートは含まない）。`folderPath` と同じ長さ・同じ並び。 */
  folderIdPath: string[];    // 追加
  aliases: string[];
  …
}
```

`buildIndex` の `walk` は既に `folderPath` を積みながら再帰しているため、**同じ場所で ID も積む**（走査を増やさない）。

```
walk(nodes, folderPath, folderIdPath):
  url を持つ → entries.push({ …, folderPath, folderIdPath })
  真のルート  → walk(children, folderPath, folderIdPath)          // 自身を積まない（既存の意味論）
  それ以外    → walk(children, [...folderPath, node.title], [...folderIdPath, node.id])
```

#### (b) `inScope` を祖先判定へ

```ts
/**
 * スコープ未指定(=「すべて」)は全件対象。指定時は**当該フォルダの配下すべて**（直下 + サブフォルダの中身）
 * を対象とする（`folder-scope-descendants`）。
 */
private inScope(entry: SearchEntry, scope: FolderScope | undefined): boolean {
  if (!scope) {
    return true;
  }
  return entry.folderIdPath.includes(scope.folderId);
}
```

- `includes` は深さ分の線形探索だが、深さは実運用で数段。件数 × 深さでも十分軽い（既存の `filter` 内での判定コストと同オーダー）。
- **直下判定（`parentId === folderId`）は捨てず**、並び替え用に別途使う（下記 (c)）。

#### (c) ブラウズ時の2グループ並び

```ts
search(query) {
  const scoped = this.entries.filter(entry => this.inScope(entry, query.folderScope));

  if (keywords.length === 0) {
    // ブラウズ: スコープ指定時のみ「直下 → それ以外」の2グループ。各グループ内はタイトル昇順（従来どおり）。
    return this.sortBrowseItems(scoped.map(entry => this.toBrowseItem(entry)), query.folderScope, scoped);
  }
  …従来どおり（スコア降順 → タイトル昇順）
}
```

実装は「グループキー（直下=0 / それ以外=1）を先に比較し、同値なら従来の比較へ落とす」だけにする。純粋な比較関数として切り出し、テストで固定する:

```ts
/**
 * ブラウズ（クエリなし）の並び。スコープ指定時は**直下を先頭グループ**にする。
 * `directParentId` が `undefined`（=「すべて」）ならグループ分けせず従来どおりタイトル昇順。
 */
const compareBrowse = (a: SearchResultItem, b: SearchResultItem, directParentId: string | undefined): number
```

- グループ判定は `item.node.parentId === directParentId`。`SearchResultItem` は `node` を持つため追加情報は要らない。
- **検索時にこの関数を使わない**ことをコメントで明示する（決定事項2: 検索は関連度順）。

### 2. `packages/shared/lib/types/search.ts`（doc の改訂）

`SearchQuery.folderScope` と `FolderScope` の doc コメントが「直下のみ」と書いてあるため、「配下すべて」へ改める。**型そのものは変更しない**（呼び出し側の変更が不要）。

### 3. `pages/popup/src/components/resultMetaModel.ts` + i18n（文言）

- `popupMetaScopedBrowse` の文言を「`$1 の直下 — $2件`」から**配下すべてを表す文言**へ変更する:
  - ja: `$1 の中 — $2件`
  - en: `In $1 — $2 items`
  - 「直下」という限定語を外すだけの最小変更にする（「配下」は日常語として硬いため「の中」を採る）。
- `resultMetaModel.ts` の doc コメントの表も追従させる。キー名・引数の構造は変えない（テストの変更も不要）。

## データフロー

### UC-A: サブフォルダを持つフォルダをブラウズする
```
1. 左ペインで「開発」を選ぶ → scopeFolderId = 開発の ID
2. useSearch → SearchEngine.search({ keywords: [], folderScope: { folderId: 開発 } })
3. inScope: entry.folderIdPath に 開発 の ID を含むエントリを通す
   → 開発/直下 ・ 開発/chrome/* ・ 開発/aws/* すべてが対象
4. compareBrowse: 開発の直下（parentId === 開発）を先頭グループ、それ以外を後続グループへ
5. 右ペイン: 直下がまとまって上に、続いてサブフォルダの中身（各行のパスでどこにあるか分かる）
```

### UC-B: スコープを保ったまま検索する
```
1. 「開発」スコープのまま `mv3` と入力
2. inScope は同じ（配下すべて）。keywords があるため compareBrowse は使わない
3. 従来どおりスコア降順 → タイトル昇順。深い階層の別名完全一致が直下の部分一致より上に来る
```

## エラーハンドリング戦略

新しいエラー経路は無い。索引構築時に ID を積むだけで、外部 API 呼び出しも増えない。

## テスト戦略

### ユニットテスト（`packages/shared/lib/search/SearchEngine.test.ts` に追加）

既存のテストデータ（ツリー）にサブフォルダ階層を足したうえで:

- **スコープ判定**
  - 親フォルダを指定すると、直下 + サブフォルダ内のブックマークがすべて含まれる
  - 孫フォルダを指定すると、その配下だけに絞られる（親の直下は含まれない）
  - **同名フォルダが別階層にあっても混ざらない**（ID 判定であることの固定）
  - スコープ未指定（「すべて」）は全件
- **ブラウズ時の並び**
  - 直下のブックマークがサブフォルダ内のものより先に並ぶ
  - 直下グループ内・それ以外グループ内はそれぞれタイトル昇順
  - 孫とひ孫は深さで区別されない（2段階であることの固定）
  - スコープ未指定のときはグループ分けが起きない（全件タイトル昇順）
- **検索時の並び**
  - キーワードありのときは階層に関係なくスコア順（深い階層の別名完全一致が直下の弱い一致より上）

### 既存テストへの影響

`SearchEngine.test.ts` の既存ケースのうち、**スコープ指定で「直下のみ」を期待しているもの**は仕様変更に伴い期待値を更新する（変更理由をテスト名/コメントに残す）。それ以外（スコアリング・別名・あいまい一致）は不変。

### 手動確認（受け入れ時）

- サブフォルダを持つフォルダを選ぶと中身が出る／左ペインの件数と一致する
- 直下がまとまって上に並ぶ
- 検索するとスコア順になる（階層で並ばない）
- 「すべて」の表示が変わっていない

## 依存ライブラリ

追加なし。

## ディレクトリ構造

```
packages/shared/lib/search/
├── SearchEngine.ts        (改訂: folderIdPath / inScope / compareBrowse)
└── SearchEngine.test.ts   (改訂: スコープ・並びのテスト追加、既存期待値の更新)

packages/shared/lib/types/search.ts            (doc コメントの改訂のみ)
pages/popup/src/components/resultMetaModel.ts  (doc コメントの改訂のみ)
packages/i18n/locales/{ja,en}/messages.json    (popupMetaScopedBrowse の文言変更)

docs/product-requirements.md   (機能5 の受け入れ条件を改訂)
docs/functional-design.md      (非採用項目 #4 を再改訂・右ペインの説明)
docs/design/README.md          (右ペインの表示仕様・操作一覧)
```

## 実装の順序

1. `SearchEntry.folderIdPath` の追加（`buildIndex`）
2. `inScope` の祖先判定化
3. `compareBrowse`（ブラウズ時の2グループ並び）
4. テスト追加・既存期待値の更新
5. 型/モデルの doc コメント改訂 + i18n の文言変更
6. 品質ゲート
7. 永続ドキュメント更新（PRD・functional-design・design）

## セキュリティ考慮事項

権限・データフローの変更なし。

## パフォーマンス考慮事項

- 索引エントリごとに文字列配列が1つ増える（深さ分の要素）。数千件 × 数段でも数十 KB 程度で、メモリ上の索引としては無視できる。
- `inScope` の判定は `includes`（深さ分の線形探索）。従来の `===` 1回から増えるが、深さは実運用で数段であり、フィルタ全体のコストは変わらない水準。
- 表示件数は増える（フォルダによっては大きく増える）。右ペインは仮想スクロールのため、描画コストは件数に比例しない。

## 将来の拡張性

- `folderIdPath` は「このブックマークがどの階層にあるか」を ID で持つため、将来「サブフォルダごとに見出しを出す」「深さでインデントする」といった表示にも使える。
- スコープの意味を切り替えたくなった場合（直下のみ / 配下すべて）は `inScope` の1関数に閉じているため差し替えが容易。ただし本単位では**切り替えオプションを設けない**（スコープ外）。
