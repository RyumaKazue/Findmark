# タスクリスト — U6 search-engine

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

## フェーズ1: 型定義の拡張

- [x] `packages/shared/lib/types/search.ts` を拡張
  - [x] `MatchedField = 'title' | 'folder' | 'alias'` を追加
  - [x] `SearchResultItem` を functional-design 準拠へ拡張（`folderPath` / `aliases` / `matchedFields` 追加、既存 `node`/`matchedAliases`/`score` は維持）
  - [x] `SearchQuery`（`keywords: string[]` / `folderScope?: FolderScope`）を追加

## フェーズ2: Levenshtein 近似部分一致

- [x] `packages/shared/lib/search/fuzzy.ts` を新規作成
  - [x] `approxSubstringDistance(pattern, text)` を実装（先頭行 0 初期化 DP・最終行最小値）
  - [x] `fuzzyThreshold(len)` を実装（≤4→1 / ≥5→2）
- [x] `packages/shared/lib/search/fuzzy.test.ts` を作成
  - [x] 距離 0/1/2 と部分文字列一致の距離値を検証
  - [x] `fuzzyThreshold` の境界（4/5 文字）を検証

## フェーズ3: SearchEngine 本体

- [x] `packages/shared/lib/search/SearchEngine.ts` を新規作成
  - [x] スコア定数（基礎点・位置ボーナス）と `SearchEntry` 内部型を定義
  - [x] `buildIndex(tree, aliasMap)`: ツリー走査でフォルダ名/ID パスを積み、url ノードのみエントリ化、別名を `hashUrl` で紐付け（不正 URL は防御的に空別名）
  - [x] `loadIndex(bookmarkService, aliasStore)`: 構造インターフェースで受け、getTree/getAll → buildIndex
  - [x] `search(query)`: 正規化 → folderScope 範囲判定 → AND 部分一致 → スコア合算 → matchedFields/matchedAliases 収集
  - [x] スコア降順・同点 title 昇順の安定ソート
  - [x] 空キーワード時のブラウズ挙動（folderScope フィルタのみ・score 0・title 昇順）
  - [x] `fuzzyFallback`: 結果 0 件時のみ発火、AND 維持、しきい値適用

## フェーズ4: エクスポート

- [x] `packages/shared/lib/search/index.ts` に `SearchEngine` と `fuzzy` を追加
- [x] `SearchQuery` / `SearchResultItem` / `MatchedField` が `@extension/shared` から取得できることを確認（`types/index.ts` 経由）

## フェーズ5: ユニットテスト

- [x] `packages/shared/lib/search/SearchEngine.test.ts` を作成
  - [x] 正規化 AND 部分一致（全角半角・大小・かな/カナ、複数語 AND）
  - [x] 照合フィールド（タイトル/フォルダ名/別名 単独ヒット）
  - [x] matchedAliases / matchedFields の付与
  - [x] folderScope（includeSubfolders true/false、`/` 含みフォルダ名、scope は照合対象外）
  - [x] スコアリング（完全>前方>部分、title>alias>folder、同点 title 昇順）
  - [x] フォールバック（ヒット時非発火、0 件時発火、しきい値境界、別名フィールドでの近似一致）
  - [x] 索引（フォルダ除外、urlHash 紐付け、不正 URL で落ちない）
  - [x] （implementation-validator指摘への対応）フォールバック経路での matchedFields/matchedAliases（alias フィールド）のカバレッジ追加

## フェーズ6: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `pnpm test`
- [x] リントエラーがないことを確認
  - [x] `pnpm lint`
- [x] 型エラーがないことを確認
  - [x] `pnpm type-check`

## フェーズ7: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 受け入れ基準（requirements.mdの各要件）と実装を突き合わせOK/NGを一覧化
- [x] implementation-validator サブエージェントによる品質検証（ブロッカーなし。推奨改善1件はフォールバック×別名一致テストを追加して対応済み）
- [x] ユーザーに検証を依頼
- [x] 受け入れ承認（ゲート2）を取得
  - NGなし。全14項目OKで承認取得(2026-07-25)。

## フェーズ8: ドキュメント更新・振り返り（モード4）

- [x] `docs/mvp-development-flow.md` の進捗表を U6 完了に更新
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

なし（ラウンド1で全項目OK・NGなしで承認取得）。

---

## 実装後の振り返り

### 実装完了日
2026-07-25

### 計画と実績の差分

**計画と異なった点**:
- 計画フェーズ中、ユーザーからフォルダ名検索の挙動について質問があり、「フォルダ名で検索した場合、直下だけでなくサブディレクトリ配下のブックマークも表示するか」を明示的に確認した。design.md の当初案（サブツリー全体照合）がそのままユーザーの意図と一致していたため設計変更はなかったが、requirements.md / design.md に「決定事項」として明記し、仕様の曖昧さを解消した。
- implementation-validator サブエージェントの検証で「フォールバック(あいまい一致)経路での別名(alias)フィールド一致がテスト未カバー」との推奨改善(ブロッカーではない)を受け、テストケースを1件追加した(フェーズ5に反映)。

**新たに必要になったタスク**:
- フォールバック×別名一致のテストケース追加(`SearchEngine.test.ts`)。implementation-validator の指摘を受けて計画時のタスクリストに無かった検証観点を補完した。

### 検証の要約（モード3）

- 検証→戻りのラウンド数: 0（NGなし、ラウンド1で受け入れ承認取得)
- 主な不一致と分類: なし
- 受け入れ承認: 2026-07-25

### 学んだこと

**技術的な学び**:
- `search()` を同期関数として提供するため、索引構築(非同期)と検索(同期)を明確に分離する設計が、性能要件(1,000件で1文字100ms以内)と単体テストのしやすさの両方に効いた。
- 「部分文字列マッチングの編集距離」(DPの0行目を全て0で初期化する変形Levenshtein)は、通常のLevenshteinと異なり「text中のどこかにある最も近い部分文字列」との距離を返す。実装時に手計算で期待値を誤ったケース(`'gti'` vs `'github'`)があり、期待値はテストで実際に計算させて確認する方が安全だと分かった。
- `AliasStore`(U5)の依存性注入パターン(`AliasNormalizer`インターフェースを構造的に満たす実装を呼び出し側が注入)を`SearchEngine`にも踏襲したことで、`packages/shared`→`packages/storage`の型のみ依存を保ったまま、chrome API非依存の純粋ロジックとして実装・テストできた。

**プロセス上の改善点**:
- 計画承認ゲート(4.5)で仕様の曖昧点(フォルダ名照合の範囲)をユーザーに確認できたことで、実装後の手戻りを防げた。曖昧な受け入れ基準は実装前に具体例(プレビュー)で確認するのが有効だった。
- implementation-validatorによる検証は、テストカバレッジの盲点(フォールバック×別名一致)を機械的に発見するのに有効だった。

### 次回への改善提案
- U7(popup-search-shell)実装時は、本作業単位で確立した `SearchEngine.loadIndex(bookmarkService, aliasStore)` / `search(query)` のインターフェースをそのまま`useSearch`フックから呼び出す想定。索引の再構築タイミング(ブックマーク変更時など)はU7側の責務として設計する。
- スコア定数(`FIELD_BASE_SCORE`/`POSITION_BONUS`)は現状ファイル内のプライベート定数だが、将来UIでスコア内訳を表示するなどの要件が出た場合はエクスポートを検討する。
