# 要求内容 — U6a search-scope-revision

## 概要

`SearchQuery.folderScope` から `includeSubfolders` フラグを廃止し、**フォルダスコープ指定時は常に「直下のみ」** を対象とする。スコープ未指定（=「すべて」）は従来どおり全ブックマークを対象とする。仕様変更に伴い U6(SearchEngine) の型・実装・テストを是正する。

## 背景

キーボード完結ナビゲーションの仕様変更（`docs/ideas/keyboard-first-navigation.md`）により、フォルダ絞り込みの方式が変わった。

**変更前**: 左ペインのフォルダを選ぶと「そのフォルダ + サブフォルダ配下」が対象。チップクリックで「直下のみ」にトグルできる。

**変更後**: 左ペインのフォーカスが常にどれか1つのフォルダに当たっており（=スコープ）、その **直下のブックマークのみ** が右ペインに出る。サブフォルダ配下を見たいときは左ペインでそのフォルダへ移動する。「サブフォルダを含む」という指定自体を持たない（「直下のみ」か「すべて」かの2択）。

この方式変更により `includeSubfolders` は選択肢として存在しなくなるため、型・分岐・テストから除去する。左ペインのキーボード操作そのもの（`↑↓`/`←`/`→`/`Enter`/`Home`）は U8a・U11 が担い、本単位は **検索ロジック側の範囲判定のみ** を扱う。

- 引用元:
  - PRD 機能5「フォルダスコープ(左ペインと右ペインの連携)」（`docs/product-requirements.md`）
  - PRD 機能2「検索マッチング(正規化)」（同上）
  - functional-design「SearchEngine(検索・マッチング)」の `SearchQuery` / 照合ルール / スコープの適用ルール（`docs/functional-design.md`）
  - functional-design「アルゴリズム設計 > ステップ2: AND部分一致」（同上）
  - `docs/ideas/keyboard-first-navigation.md`（仕様変更の経緯・決定#3/#4/#5）
  - architecture.md レイヤー依存「UI → サービス → データ」（SearchEngine はサービス層）

## 実装対象の機能

### 1. FolderScope 型からの `includeSubfolders` 廃止
- `packages/shared/lib/types/search.ts` の `FolderScope` を `{ folderId: string }` のみにする。
- JSDoc を新仕様（スコープ・直下のみ）に合わせて是正する。

### 2. SearchEngine.inScope の直下判定への一本化
- `inScope()` の `includeSubfolders` 分岐を削除し、`entry.node.parentId === scope.folderId` に一本化する。
- スコープ未指定（`undefined`）は全件対象のまま維持する。

### 3. 呼び出し側（useSearch）の追随
- `pages/popup/src/hooks/useSearch.ts` の `{ folderId, includeSubfolders: true }` から当該フラグを落とす。
- JSDoc の「そのフォルダ配下（サブフォルダ含む）に絞り込む」記述を新仕様へ是正する。

### 4. テストの是正
- `includeSubfolders` を使う既存4テストを新仕様前提へ書き換える。
- 「サブフォルダ配下は範囲に含まれない」ことを明示的に検証するテストを追加する。
- スコープ未指定＝全件対象であることを検証するテストを追加する。

## 受け入れ条件

> 出典: `docs/mvp-development-flow.md` U6a 行「受け入れ基準」。

### `includeSubfolders` の廃止
- [ ] `includeSubfolders` が **型定義・実装・テストのいずれからも消えている**（リポジトリのソースを grep して 0 件）。
- [ ] `FolderScope` が `folderId` のみを持つ。

### スコープ指定時の範囲（直下のみ）
- [ ] `folderScope` を指定すると、そのフォルダの **直下のブックマークのみ** に絞られる。
- [ ] サブフォルダ配下のブックマークは範囲に **含まれない**。
- [ ] フォルダ名に `/` を含んでいても範囲フィルタが壊れない（ID ベース判定の維持）。
- [ ] `folderScope` は引き続き **照合対象から除外** される（範囲フィルタとしてのみ機能する）。

### スコープ未指定時の範囲（「すべて」）
- [ ] `folderScope` 未指定のとき、全ブックマークが対象になる。

### 並び順の維持（本単位では変更しない）
- [ ] 空クエリのブラウズが **タイトル昇順のまま** である（「最近順」は採用しない＝ functional-design「デザイン非採用項目」#2 を維持）。

### 品質
- [ ] 既存の検索テストがすべてパスする（`pnpm test`）。
- [ ] `pnpm lint` / `pnpm type-check` がエラーなく通る。

## 成功指標

- ソースコード上の `includeSubfolders` の grep ヒット数が 0。
- `SearchEngine.test.ts` のスコープ関連テストが、直下のみ方式を正として通る。
- 既存テスト（AND部分一致・スコアリング・フォールバック・別名）に回帰がない。

## スコープ外

以下はこのフェーズでは実装しません:

- **左ペインのキーボード操作**（`↑↓`/`←`/`→`/`Enter`/`Home`、スコープ追従）→ U8a / U11
- **フォーカス3状態の導入**（検索ボックス / 右ペイン / 左ペイン）→ U8a
- **Escape の4段階戻り** → U8a
- **フォルダチップのスコープ可視化表示** → U11
- **並び順の変更**（「最近順」への変更）→ 将来のロジック改修単位（functional-design「デザイン非採用項目」#2）
- **「すべて」をスコープとして明示的に表現する UI 状態**（現状は `folderId: null` で表現済み）→ U11

## 参照ドキュメント

- `docs/product-requirements.md` - プロダクト要求定義書（機能2 / 機能5）
- `docs/functional-design.md` - 機能設計書（SearchEngine / スコープの適用ルール / デザイン非採用項目）
- `docs/architecture.md` - アーキテクチャ設計書（レイヤー依存）
- `docs/ideas/keyboard-first-navigation.md` - 仕様変更の経緯
- `docs/mvp-development-flow.md` - U6a 行
