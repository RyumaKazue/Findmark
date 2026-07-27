# 設計書 — U9 alias-editor

## アーキテクチャ概要

architecture.md のレイヤー依存「UI → サービス → データ」に従う。別名編集の**中核ロジックは React/DOM 非依存の純粋モジュール**（`aliasEditorModel.ts`）に閉じ込め、`AliasEditor.tsx`（React 層）と単体テストの双方から使う（既存の `folderTreeModel.ts` / `virtualization.ts` / `modeMachine.ts` と同じ設計思想）。永続化は既存データ層 `AliasStore`（U5）を使い、UI は chrome API を直接触らない。検索索引への即時反映のため `SearchEngine`（U6）に別名差し替えメソッドを1つ追加する。

```
[AliasEditor.tsx] ──(intent)──► [aliasEditorModel.ts]（純粋: 確定/重複/上限/削除/並び）
        │                              ▲ normalizeText を注入（DI）
        │ onCommit(aliases)            │
        ▼                              │
[Popup.tsx] ──► AliasStore.upsert(url, aliases)（永続化・U5）
        │   └─► useSearch.updateAliases(url, aliases)
        ▼                    └─► SearchEngine.updateAliases + setResults(runSearch())（索引即時反映・再検索）
[ResultList/ResultRow] ── ALIAS_EDIT の対象行のみ AliasEditor を差し込む（状態1e）
```

## コンポーネント設計

### 1. `aliasEditorModel.ts`（純粋ロジック・新規）
**責務**:
- 入力テキストのチップ確定判定（trim・空/長さ超過/正規化重複/上限の分類）。
- チップの削除（末尾/インデックス指定）。
- マッチ別名を先頭に寄せる並び替え。
- 上限定数（`MAX_ALIASES`=20 / `MAX_ALIAS_LENGTH`=50）は **`AliasStore` から re-export** して参照し、UI とデータ層で二重定義しない（ドリフト防止）。

**実装の要点**:
- 正規化重複判定は `normalizeText` を**引数注入**（`packages/shared` の `normalizer` を注入）。storage への逆依存を作らない。
- `commitAlias(existing, raw, normalize)` は判別可能ユニオンを返す:
  - `{ type: 'added'; aliases }` / `{ type: 'duplicate'; index }`（既存チップ位置） / `{ type: 'empty' }` / `{ type: 'too-long' }` / `{ type: 'at-limit' }`
- `removeAt(existing, index)` / `removeLast(existing)` は新配列を返す（不変）。
- `orderMatchedFirst(aliases, matched)` はマッチを先頭に、順序安定で返す。

### 2. `AliasEditor.tsx`（React 層・新規）
**責務**:
- 状態1e のチップ入力ボックスを描画（既存チップ＋`✕`、入力欄、ヒント、上限 `n/20`）。
- キー操作（Enter/`,`/Space=確定、空入力 Backspace=末尾削除、Escape=編集終了）を処理。
- チップ `✕`＝個別削除、チップクリック＝入力欄へ戻して再編集。
- 重複時は該当既存チップを一瞬光らせる（blink：一時的な className をタイマーで外す）。
- 別名変更のたびに `onCommit(aliases)` を呼ぶ（楽観更新→失敗でロールバック）。

**実装の要点**:
- チップ集合は `useState<string[]>`（`initialAliases` を `orderMatchedFirst` で初期化）。入力欄は別 state。
- **IME**: `e.nativeEvent.isComposing` が真なら確定キー処理をスキップ（日本語変換確定の誤爆防止）。`,`/Space は `preventDefault` で文字挿入を抑止。
- マウント時に入力欄へ `autoFocus`。ボタン内包を避けるため、編集行はネイティブ `<button>` にしない（下記 ResultRow 変更参照）。
- `props`: `url`, `initialAliases`, `matchedAliases`, `onCommit: (aliases) => Promise<void>`, `onClose: () => void`。chrome API・store を直接持たず、副作用は props 経由（テスト容易性）。

### 3. `ResultRow.tsx` / `ResultList.tsx`（変更）
**責務**: ALIAS_EDIT の対象行だけ、2 段目を `AliasEditor` に差し替える（他は現状の表示のまま）。
**実装の要点**:
- `ResultRow` に `editingAlias?: boolean` と `onEnterAliasEdit?: () => void`、編集用 props を追加。
- 編集中は行全体を `<button>` にできない（input 内包は不正・クリックで開いてしまう）。編集中は `<div>` コンテナで 1 段目＝テキスト表示、2 段目＝`AliasEditor` を描画する。
- 通常時は 2 段目の別名チップ領域クリックで `onEnterAliasEdit`（`stopPropagation` で「開く」を抑止）。
- `ResultList` は `editingAliasId` と各コールバックを受け取り、対象 `item.node.id` の行へ渡す。仮想スクロールのウィンドウ内に対象行が入るよう、編集開始時に選択インデックス＝対象行にしておく（既存の追従ロジックを利用）。

### 4. `SearchEngine.updateAliases(url, aliases)`（U6 に追加）
**責務**: 索引上で、指定 URL と**同一 urlHash** のエントリの `aliases`/`nAliases` を差し替える（別名編集の即時反映）。
**実装の要点**: `hashUrl` で対象を判定（正規化 URL 単位＝別名キーの意味論に一致）。不正 URL は握り潰してスキップ。純粋にメモリ内エントリを更新するのみ（副作用は索引のみ）。

### 5. `useSearch.ts`（変更）
**責務**: 別名編集を索引へ反映し再検索を促す。
**実装の要点**: 検索実行を `runSearch()`（`useCallback`・依存は query/folder/ready）に切り出し、`results` を state 化する。
クエリ/フォルダ/索引準備の変化時は effect で `setResults(runSearch())`。`updateAliases(url, aliases)` を公開し、
`searchEngine.updateAliases` 実行後に `setResults(runSearch())` で即時再検索する。
（当初案の `indexVersion` カウンタ方式は、未参照の依存を持つ `useMemo` が `react-hooks/exhaustive-deps` の
「unnecessary dependency」警告を生むため、`runSearch` を単一の source とする本方式に変更した。）

### 6. `Popup.tsx`（変更）
**責務**: モード遷移の結線と AliasEditor への props 供給。
**実装の要点**:
- document キーダウンで、`currentMode === 'LIST'` かつ選択行があるとき `resolveShortcutIntent(e) === 'alias-edit'` なら `enterAliasEdit(selectedRow.node.id)`（他 intent は本単位のスコープ外＝無視）。
- `mode.targetId` から対象 `SearchResultItem` を引く。見つからなければ `exitToList()`。
- `onCommit`: `await aliasStore.upsert(url, aliases)` → `updateAliases(url, aliases)`。失敗時はログのみ（AliasEditor 側で state ロールバック）。
- `onClose`: `exitToList()` ＋ 検索ボックスへフォーカス復帰（検索ファースト）。

## データフロー

### 別名を確定する（UC-2）
```
1. LIST で行を選択 → Ctrl/Cmd+; または別名エリアクリック → enterAliasEdit(node.id)
2. ALIAS_EDIT 表示。入力 "こうし" → Enter（IME 確定でない）
3. commitAlias(existing, "こうし", normalizeText)
   - duplicate → 既存チップを blink（保存しない）
   - too-long/at-limit → 追加せず上限表示を強調
   - added → chips 更新（楽観）→ onCommit(chips)
4. onCommit: AliasStore.upsert(url, chips) → SearchEngine.updateAliases → 再検索で行表示更新
5. Escape → exitToList → LIST・検索ボックスにフォーカス
```

## エラーハンドリング戦略

### カスタムエラークラス
新規なし。データ層の `AliasLimitError`（U5）を利用。UI は事前に上限判定して超過入力を防ぐため通常は発火しないが、防御的に upsert 失敗を捕捉してロールバック＋`console.error`（development-guidelines「握り潰さずログ」）。

### エラーハンドリングパターン
- `onCommit` の upsert 失敗: AliasEditor は直前の chips に戻し（ロールバック）、索引反映も行わない。ユーザー操作は継続可能。
- 対象行消失: 例外ではなく `exitToList()` で穏当に復帰。

## テスト戦略

### ユニットテスト（Node 環境・`src/**/*.test.ts`、既存方針に一致）
- `aliasEditorModel.test.ts`:
  - `commitAlias`: added / empty(空白のみ) / too-long(51文字) / duplicate(全角半角・大小・カナで正規化一致 → index 返却) / at-limit(20個到達)
  - `removeAt` / `removeLast`: 不変・境界
  - `orderMatchedFirst`: マッチ先頭・順序安定・マッチ不在
  - 正規化は実 `normalizer`（`@extension/shared`）を注入して実挙動を検証
- `SearchEngine.test.ts`（追記）: `updateAliases` で別名差し替え後、旧別名で不一致・新別名で一致すること／同一正規化URLの複数エントリに適用されること

### 統合テスト
- React コンポーネントの DOM テストは既存方針（popup は Node 環境・純粋ロジックのみ、UI 主要導線は E2E 担保）に合わせ**本単位では追加しない**。AliasEditor の振る舞いは純粋モデルのテストで最大限カバーする。

## 依存ライブラリ
新規追加なし。

## ディレクトリ構造
```
pages/popup/src/
├── components/
│   ├── AliasEditor.tsx            （新規）
│   ├── aliasEditorModel.ts        （新規・純粋）
│   ├── aliasEditorModel.test.ts   （新規）
│   ├── ResultRow.tsx              （変更: 編集差し替え・別名エリアクリック）
│   └── ResultList.tsx             （変更: editingAliasId とコールバックの受け渡し）
├── hooks/
│   └── useSearch.ts               （変更: updateAliases / indexVersion）
└── Popup.tsx                      （変更: alias-edit 入口結線・AliasEditor props）

packages/shared/lib/search/
├── SearchEngine.ts                （変更: updateAliases 追加）
└── SearchEngine.test.ts           （変更: updateAliases のテスト追加）

packages/storage/lib/impl/
└── aliasStore.ts                  （変更: MAX_ALIASES / MAX_ALIAS_LENGTH を export）
```

## 実装の順序
1. `aliasStore.ts` に上限定数を export（データ層の単一定義化）
2. `aliasEditorModel.ts` ＋ テスト
3. `SearchEngine.updateAliases` ＋ テスト
4. `useSearch` に `updateAliases`/`indexVersion`
5. `AliasEditor.tsx`
6. `ResultRow`/`ResultList` の差し替え結線
7. `Popup.tsx` のモード入口・props 供給

## セキュリティ考慮事項
- 外部通信ゼロを維持（別名は `AliasStore` 経由で `chrome.storage` のみ）。`fetch`/XHR は追加しない。
- 別名は表示時に React の既定エスケープに委ね、`dangerouslySetInnerHTML` を使わない。

## パフォーマンス考慮事項
- `SearchEngine.updateAliases` はメモリ内更新のみ（chrome 往復なし）で編集の体感即時性を確保。
- 正規化はモデル内で入力確定時にのみ実施（1文字ごとの重い再計算をしない）。

## 将来の拡張性
- `alias:candidate-up/down`（候補サジェスト）や未ヒット時の別名登録提案は、`aliasEditorModel` に候補選択関数を足す形で拡張できる（本単位ではキー意味論のみ U8 に存在）。
- 上限定数の単一化により、将来の上限変更が data 層1箇所で完結する。
