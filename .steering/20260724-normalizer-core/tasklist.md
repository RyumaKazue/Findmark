# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース
以下の技術的理由に該当する場合のみスキップ可能:
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:
```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

---

## フェーズ1: ドメイン型の定義（packages/shared/lib/types/）

- [x] `types/bookmark.ts` に `BookmarkNode`（id/parentId/title/url/dateAdded/children）を定義（id は紐付けキーに使わない旨をコメント）
- [x] `types/alias.ts` に `AliasRecord` / `AliasChunk` / `AliasIndex` を定義（20個・50文字制約はコメント明記、検証実装は U5）
- [x] `types/search.ts` に `SearchResultItem`（ブックマーク + matchedAliases + score 等）と `FolderScope` を定義
- [x] `types/index.ts`（バレル）を作成し全型を再エクスポート

## フェーズ2: Normalizer の実装（packages/shared/lib/search/）

- [x] `Normalizer.ts` に `class Normalizer` の骨組みと既定インスタンス export を用意
- [x] `normalizeText(input)` を実装（NFKC → toLowerCase → カタカナ→ひらがな）
- [x] `normalizeUrl(raw)` を実装（hash 除去 / 末尾スラッシュ正規化（`/` 単体は保持）/ クエリ保持）
- [x] `hashUrl(url)` を実装（FNV-1a 32bit・同期・符号なし16進）
- [x] 不正 URL 時の挙動（throw 素通し）と各メソッドの前提を JSDoc に明記
- [x] `search/index.ts`（バレル）を作成

## フェーズ3: 公開 API（バレル）整備

- [x] `packages/shared/index.mts` に `search/index.js` と `types/index.js` の再エクスポートを追加
- [x] `@extension/shared` から `Normalizer` と各型が import できることを確認（型解決）（フェーズ5 の type-check で担保）

## フェーズ4: ユニットテスト（co-located）

- [x] `Normalizer.test.ts` を作成
  - [x] `normalizeText`: 全角英数⇔半角 / 大小文字 / カタカナ⇔ひらがな / 半角カナ→ひらがな / 混在 / 空文字
  - [x] `normalizeUrl`: フラグメント除去 / 末尾スラッシュ除去 / ルート `/` 保持 / クエリ保持 / クエリ差の区別
  - [x] `hashUrl`: 決定性 / フラグメント差の同一化 / クエリ差の別ハッシュ / 非衝突（現実サンプル）/ 同期（string 返却）
  - [x] 異常系: 不正 URL で throw
- [x] `pnpm -F @extension/shared test` でパスすることを確認（23 tests pass）

## フェーズ5: 品質チェックと修正

- [x] `pnpm -F @extension/shared test` が通ることを確認（23 tests pass）
- [x] `pnpm type-check` がエラーなく通ることを確認（14 tasks 成功）
- [x] `pnpm lint` がエラーなく通ることを確認（15 tasks 成功）
- [x] `pnpm build` が成功し、dist に test ファイルが流出しないことを確認（16 tasks 成功。Normalizer.js/types 出力、test 非流出）

## フェーズ6: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.mdの各要件）と実装を突き合わせOK/NGを一覧化（全項目OK）
- [x] `implementation-validator` サブエージェントで品質検証（4.9/5・ブロッカーなし。提案1: SearchResultItem のフィールド名を functional-design 準拠の `node` へ揃える → 対応済み）
- [x] ユーザーに検証を依頼し、受け入れ承認（ゲート2）を取得（2026-07-25 承認取得）
  - NGがあった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ7: ドキュメント更新・振り返り（モード4）

- [x] `docs/mvp-development-flow.md` の進捗表で U3 を「完了」に更新
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

- なし

---

## 実装後の振り返り

### 実装完了日
2026-07-25

### 計画と実績の差分

**計画と異なった点**:
- ほぼ計画通り。実装形態は承認された方針どおり `class Normalizer` + 既定インスタンス `normalizer` を export。ドメイン型も中核（BookmarkNode / AliasRecord 系 / SearchResultItem / FolderScope）に限定。`hashUrl` は 32bit で確定。

**新たに必要になったタスク**:
- `SearchResultItem` のフィールド名を `bookmark` → `node` へ変更（`implementation-validator` の提案1）。functional-design の `SearchResultItem.node` に合わせ、U6 SearchEngine が同ドキュメントを参照する際の命名揺れ・手戻りを予防。型のみの変更で参照コードは無く、shared type-check 通過を確認。

**技術的理由でスキップしたタスク**（該当する場合のみ）:
- なし（全タスク完了）。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 0（受け入れ基準は全項目 OK で一発通過）
- 主な不一致と分類: なし（validator の提案1=命名揃えは受け入れ前の自己修正であり手戻りに非該当）
- 受け入れ承認: 2026-07-25 取得

### 学んだこと

**技術的な学び**:
- `normalizeText` は NFKC を最初に適用するのが要。半角カナ（`ｷﾞ` 等）は NFKC で全角カナ（`ギ`）へ寄り、その後の `[ァ-ヶ]` 置換でひらがな化される。順序を誤ると半角カナが同値化されない。
- `URL` API はホストを punycode、パス/クエリを percent-encoding で ASCII 化するため、`hashUrl` が `charCodeAt`（UTF-16 コード単位）で FNV-1a を計算しても非 ASCII を含む URL で破綻しない（validator 指摘の裏取り）。
- U2 で入れた「build tsconfig の test 除外」により、co-located `Normalizer.test.ts` は dist へ流出しない。テスト基盤の設計が後続単位でそのまま効いた。

**プロセス上の改善点**:
- functional-design にフィールド名まで定義済みの型（SearchResultItem 等）は、最小定義であっても**フィールド名を source of truth に揃えておく**と後続単位の手戻りを防げる。validator がこれを検出してくれた。

### 次回への改善提案
- U4（bookmark-service）は `packages/storage` 側の実装で、chrome.bookmarks/tabs のモックが必要になる。vitest のモック（`vi.stubGlobal('chrome', ...)` 等）方針を design で先に決める。
- U6（SearchEngine）着手時、`SearchResultItem` を functional-design の全フィールド（`folderPath` / `aliases` / `matchedFields` 等）へ拡張する。今回は `node` / `matchedAliases` / `score` の最小形。
- `hashUrl` の 32bit 衝突は U5（AliasStore）結合時に実データ規模で再確認（必要なら 64bit 化は後方互換で可能）。