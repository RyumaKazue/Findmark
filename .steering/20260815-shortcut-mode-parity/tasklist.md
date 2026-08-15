# タスクリスト

**作業単位**: `shortcut-mode-parity`（ショートカットの有効モード整合）
**参照**: [requirements.md](./requirements.md)（AC-1〜AC-7） / [design.md](./design.md)

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

## フェーズ1: 純粋関数の追加（AC-5）

- [x] `pages/popup/src/hooks/modeMachine.ts` に有効判定を追加
  - [x] `ShortcutContext` 型（`mode` / `listFocus` / `selectionCount` / `resultCount`）を定義
  - [x] 内部ヘルパー `isCaretInSearch`（`LIST` + `listFocus==='search'`）を追加し、JSDoc に「ネイティブのテキスト操作を奪わない」意図を記す
  - [x] 内部ヘルパー `hasFocusedRow`（`LIST` + `resultCount>0`）を追加し、JSDoc に「行に紐づく操作の前提」を記す
  - [x] `isShortcutEnabled(intent, ctx)` を実装
    - [x] 先頭で `isSearchFirstExempt(ctx.mode)` を弾く（編集中は全ショートカットを横取りしない規律を一括適用）
    - [x] `inline-edit` / `alias-edit` → `hasFocusedRow`
    - [x] `panel` → 選択ありは `resultCount>0`、選択なしは `hasFocusedRow`
    - [x] `delete` → `isCaretInSearch` なら false。以降 `panel` と同じ分岐
    - [x] `select-all` → `!isCaretInSearch && resultCount>0`
    - [x] `undo` / `add-current` → `true`（`undoPending` は呼び出し側の責務である旨を JSDoc に記す）
    - [x] `switch` を網羅させ `default: return false`（防御的デフォルト）
  - [x] 宣言は非 export とし、ファイル末尾の `export` / `export type` へ `isShortcutEnabled` / `ShortcutContext` を追加

## フェーズ2: マトリクステスト（AC-5）

- [x] `pages/popup/src/hooks/modeMachine.test.ts` に `describe('isShortcutEnabled')` を追加（**+23 ケース / 同ファイル計 68 件パス**）
  - [x] `delete`: FOLDER_TREE+選択あり=true / FOLDER_TREE+選択なし=false / LIST+result+選択なし=true / LIST+search+選択あり=false / 結果0件=false
  - [x] `select-all`: FOLDER_TREE=true / LIST+search=false / LIST+result=true / 結果0件=false
  - [x] `panel`: FOLDER_TREE+選択あり=true / FOLDER_TREE+選択なし=false / LIST+選択なし+結果あり=true / LIST+search=true（ネイティブの意味を持たないため Delete/Ctrl+A と異なる）
  - [x] `add-current`: FOLDER_TREE=true / LIST+search+結果0件=true
  - [x] `undo`: FOLDER_TREE=true
  - [x] `inline-edit` / `alias-edit`: FOLDER_TREE=false / LIST+結果あり=true / 結果0件=false
  - [x] 全インテント × `INLINE_EDIT`/`ALIAS_EDIT`/`PANEL`/`DRAG` = すべて false（`ALL_INTENTS` を回して網羅）
  - [x] テスト名に対応する AC 番号を含め、前単位の3件のバグに対応するケース（`panel`/`add-current`/FOLDER_TREE）を「前単位で修正済みの挙動の固定」と明示する

## フェーズ3: `Popup.tsx` の統一（AC-1 / AC-2 / AC-3 / AC-4）

- [x] `pages/popup/src/Popup.tsx` の keydown ハンドラを再構成
  - [x] `modeMachine` から `isShortcutEnabled` を import
  - [x] `shortcutCtx`（`mode`/`listFocus`/`selectionCount`/`results.length`）を組み立てる
  - [x] 7つのショートカットを**単一の共通ブロック**（`if (currentMode === 'LIST')` の外）へ集約し、`switch (shortcutIntent)` で実行を振り分ける
  - [x] `undo` は「有効だが `undoPending` が無い」場合に `break` して後続へ流す（従来のネイティブ委譲を維持）
  - [x] `panel` / `delete` の「選択あり=一括 / 選択なし=単一」の振り分けを実行部に残す
  - [x] `if (currentMode === 'LIST')` ブロックには `resolveKey` によるキー意味論の処理のみを残す
  - [x] `handleOpenAddCurrent` / `openBulkMovePanel` の `exitToList()` 経由（前単位の修正）を維持していることを確認
  - [x] 重複していた `resolveShortcutIntent` 呼び出し（従来は共通ブロックで3回 + LIST ブランチで1回）を1回に統一
  - [x] `isSearchFirstExempt` の import は残す（L707 の検索ファースト復帰判定で引き続き使用するため）
  - [x] `useEffect` の deps は既存のままで過不足なし（`eslint` の exhaustive-deps が exit 0）
  - [x] popup 単体で `type-check` / `lint` / `vitest`（208件）が exit 0

## フェーズ4: 品質チェックと修正（AC-6）

> **フォアグラウンドで実行し exit code を必ず確認する**（バックグラウンド実行では turbo が失敗しても exit 0 を返すことがある）。

- [x] `implementation-validator` サブエージェントによる品質検証を実施し、指摘に対応する
  - 総合 **5/5**（スペック準拠・コード品質・テスト・セキュリティ・パフォーマンスすべて 5）。**重大な問題なし**
  - 7つのショートカットすべてで新旧の有効条件が等価であることを validator 側でも1件ずつ確認（当方の等価性監査と一致）。
    `delete`（単一）について「`ListFocus` は `'search'|'result'` の2値なので、LIST 内では `listFocus==='result'` ≡ `!isCaretInSearch`」と裏取りされた
  - **[推奨] AC-7 ドキュメント未更新** → 本タスクリストのフェーズ6（ゲート2 後・モード4）に配置しているため想定内
  - **[提案1] `switch` の `never` による網羅性チェック** → design.md の記述が実装より強い主張になっていた点は正当な指摘。
    リポジトリ内の既存 `switch`（`modeReducer` / `resolveKeyIntent`）がいずれも `never` を使っておらず本単位だけ様式を変えると一貫性を欠くため、
    **design.md の記述を実態に合わせて訂正**し、導入は `modeMachine` の全 `switch` を対象とする横断単位へ申し送る
  - **[提案2] 「選択ありなのに結果0件」の明示テスト** → **対応済み**（`describe('選択ありなのに結果0件という不変条件違反への防御')` を追加。`panel`/`delete` × LIST/FOLDER_TREE の4アサーション）
- [x] すべてのテストが通ることを確認
  - [x] `pnpm test` → **exit 0**（13 tasks / popup **209 tests**。前単位の 185 件 + 本単位の 24 件。`modeMachine.test.ts` は 69 件）
- [x] リントエラーがないことを確認
  - [x] `pnpm lint`（`--continue` のため各パッケージの結果と最終 exit code を確認）→ **exit 0**（12 tasks successful）
- [x] 型エラーがないことを確認
  - [x] `pnpm type-check` → **exit 0**（11 tasks successful）
- [x] ビルドが通ることを確認
  - [x] `pnpm build` → **exit 0**（13 tasks successful）

## フェーズ5: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] 追加: リファクタリング前後の**等価性監査**（旧 `feature/list-arrow-wrap:Popup.tsx` の8条件と1つずつ突き合わせ）

| # | ショートカット | 旧条件 | 新条件（`isShortcutEnabled`） | 判定 |
|---|---|---|---|---|
| 1 | `undo` | `undoPending && !isSearchFirstExempt` | `!isSearchFirstExempt` → 実行部で `undoPending` を判定 | ✅ 等価 |
| 2 | `add-current` | `!isSearchFirstExempt`（結果件数を見ない） | `true`（exempt ガード後） | ✅ 等価 |
| 3 | `panel`（選択あり） | `selectionCount>0 && !isSearchFirstExempt` | `selectionCount>0 → resultCount>0` | ⚠️ 下記注記 |
| 4 | `alias-edit` | `LIST && results.length>0`（`listFocus` 不問） | `hasFocusedRow` | ✅ 等価 |
| 5 | `inline-edit` | 同上 | `hasFocusedRow` | ✅ 等価 |
| 6 | `panel`（選択なし） | `LIST && results.length>0` | `hasFocusedRow` | ✅ 等価 |
| 7 | `delete` | `LIST && listFocus==='result' && results.length>0` | `!isCaretInSearch && (選択あり→resultCount>0 / 選択なし→hasFocusedRow)` | ✅ 等価 + **FOLDER_TREE+選択あり のみ意図的に true（AC-1）** |
| 8 | `select-all` | `LIST && listFocus!=='search' && results.length>0` | `!isCaretInSearch && resultCount>0` | ✅ 等価 + **FOLDER_TREE のみ意図的に true（AC-3）** |

> **#3 の注記**: 新条件は一括移動に `resultCount > 0` を追加している（旧は無条件）。`selectionCount>0` かつ
> `resultCount===0` は「クエリ変更で結果が空になったが選択クリアの effect がまだ走っていない」瞬間にしか起こらず、
> その場合も旧コードは `openBulkMovePanel()` 内の `selectedItems.length===0` ガードで何もしなかった。
> **差は `e.preventDefault()` を呼ぶか否かだけ**で、ユーザーから見た挙動は同じ（新のほうが素通しするぶん素直）。

> **`undo` の `break` について**: 「有効だが保持なし」で `break` すると後続へ流れるが、`Ctrl+Z` は
> `resolveKeyIntent` が `none` を返し、検索ファースト復帰も `ctrlKey` で弾かれるため、結果的に何も起きない。
> 旧コード（`if` に入らず同じ場所へ落ちる）と等価。

> **ブロック順の変更について**: 旧は `undo` → Escape(選択解除) → `add-current` → `panel`(一括) の順だったが、
> 新は Escape(選択解除) → 全ショートカット の順になった。Escape と各ショートカットのキーは**互いに素**
> （`Escape` vs `Ctrl+Z`/`Ctrl+D`/`Ctrl+M`/`F2`/`Delete`/`Ctrl+A`）のため干渉しない。

- [x] 受け入れ基準（requirements.md の AC-1〜AC-7）と実装を突き合わせ OK/NG を一覧化

| AC | 内容 | 判定 | 根拠 |
|---|---|---|---|
| AC-1 | `Delete` の一括削除が FOLDER_TREE で動作 | ✅ OK（要実機確認） | `isShortcutEnabled('delete', {mode:'FOLDER_TREE', selectionCount:3})===true` のテスト。実行部は従来の `handleBulkDelete()`（1アンドゥ単位・選択クリア）をそのまま呼ぶため、一括操作バーの「削除」ボタンと同一経路 |
| AC-2 | `Delete` の単一削除は従来の制約を維持 | ✅ OK | FOLDER_TREE+選択0件=false / LIST+result+選択0件=true / LIST+search=選択の有無を問わず false の3テスト |
| AC-3 | `Ctrl/Cmd+A` が FOLDER_TREE で動作 | ✅ OK（要実機確認） | FOLDER_TREE=true / LIST+search=false / LIST+result=true の3テスト |
| AC-4 | 既存ショートカットの回帰なし | ✅ OK | 旧 `Popup.tsx` の8条件との**等価性監査**（上表）で6件が完全等価、1件は到達不能な差分のみ。validator 側でも独立に同じ結論。加えて exempt 4モード × 全7インテント = 無効 のテスト |
| AC-5 | 有効条件が純粋関数に集約されテスト済み | ✅ OK | `isShortcutEnabled` は React/DOM 非依存。`Popup.tsx` にモード・フォーカス・件数の条件式は残っていない（`isSearchFirstExempt` の残存は検索ファースト復帰用の別用途）。前単位の3件（`panel`/`add-current`/FOLDER_TREE）もテストで固定 |
| AC-6 | 品質ゲート | ✅ OK | `type-check` 0 / `lint` 0 / `test` 0（209件）/ `build` 0 |
| AC-7 | ドキュメント整合 | ⏳ 未実施 | 本タスクリストのフェーズ6（ゲート2 後・モード4）に配置。承認後に実施 |

- [x] ユーザーに検証を依頼（**回帰確認を重点的に**: 7つすべての条件式を書き換えるため影響範囲が前単位より広い）
- [x] 受け入れ承認（ゲート2）を取得 → **2026-08-15 承認（1ラウンドで通過。検証→戻りは発生せず）**
  - NG があった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ6: ドキュメント更新・振り返り（モード4・AC-7）

- [x] `docs/product-requirements.md` の「**検索ボックス**(起動直後のフォーカス位置)」を実態（既定は左ペイン＝FOLDER_TREE）に是正する
  - 見出しを「印字文字 / Backspace を打つと、どのペインからでもここへ復帰する」に変更し、起動直後の既定は左ペインである旨（U11 で変更・U19 の復元時は保存値に従う）を注記として追加
- [x] `docs/functional-design.md` の「行に紐づく操作 / 行に紐づかない操作」の表に `Delete`（一括）と `Ctrl/Cmd+A` を反映する
- [x] `docs/functional-design.md` に、有効条件が `isShortcutEnabled` に集約されている旨（実装の所在）を追記する
- [x] 追加: `docs/functional-design.md` に「検索ボックスにキャレットがあるときネイティブの意味を優先するキー」の例外を明文化する（`Delete` / `Ctrl/Cmd+A`）
- [x] 追加: `docs/product-requirements.md` のショートカット一覧の `Delete` / `Ctrl/Cmd+A` の注記を更新し、同じ例外を追記
- [x] 追加: `docs/product-requirements.md` の受け入れ基準（L205 付近）に一括削除・全件選択を追加し、検索ボックスでの例外も基準化
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

**なし**（ゲート2 を1ラウンドで通過。分類 A/B/C いずれの戻りも発生しなかった）。

前単位 `list-arrow-wrap` が3ラウンドを要したのに対し、本単位が一発で通った要因:

- 本単位の変更対象（ショートカットの有効条件）が**純粋関数として単体テスト可能な形に切り出されている**ため、
  実機確認を待たずに24ケースで挙動を固定できた。前単位の3件は「テストで検出できない React 層の結線」だった。
- リファクタリングの等価性を、旧コード（`git show feature/list-arrow-wrap:pages/popup/src/Popup.tsx`）との
  **1件ずつの突き合わせ表**として実装直後に作り、`implementation-validator` にも同じ観点で独立検証させた
  （両者の結論が一致）。

---

## 実装後の振り返り

### 実装完了日
2026-08-15（ゲート2 受け入れ承認）

### 計画と実績の差分

**計画と異なった点**:
- **計画どおり一発で完了した**。フェーズ1〜6 のすべてが design.md の想定から乖離なく進み、
  検証→戻りは0ラウンド（前単位は3ラウンド）。
- 唯一の設計修正は **design.md 自身の記述の訂正**。「`switch` を網羅させ、`ShortcutIntent` に値が増えたときに
  型エラーで気づける」と書いていたが、`never` 型による網羅性チェックを実装していないため実際には型エラーにならない。
  `implementation-validator` の指摘（提案1）を受け、**実装をドキュメントに合わせるのではなくドキュメントを実態に合わせた**
  （理由は下記「学んだこと」参照）。

**新たに必要になったタスク**:
- 等価性監査の表（フェーズ5）— 計画には無かったが、7条件すべてを書き換えるリファクタリングのため
  「意図した差分」と「意図しない差分」を分離する必要があり、実装直後に自主的に作成した。
  結果としてゲート2 の説明材料としても機能した。
- validator 提案2 への対応 — 「選択ありなのに結果0件」の不変条件違反に対する明示テスト（4アサーション）。

**技術的理由でスキップしたタスク**: なし（全タスク完了）

### 検証の要約（モード3）

- 検証→戻りのラウンド数: **0**
- 主な不一致と分類: なし
- 受け入れ承認: 2026-08-15
- `implementation-validator`: **総合 5/5**（全5観点で満点・重大な問題なし）。指摘は推奨1件（AC-7 ドキュメント＝
  フェーズ6 に配置済みで想定内）と提案2件（いずれも対応済み）。
- 品質ゲート: `type-check` 0 / `lint` 0 / `test` 0（popup 209件）/ `build` 0（すべてフォアグラウンドで exit code 確認）

### 学んだこと

**技術的な学び**:
- **条件を「ブロックの位置」で表現すると、間違えたときに静かに壊れる**。`if (currentMode === 'LIST') { ... }` の
  内側に置くこと自体が暗黙の条件になっており、型でも lint でもテストでも検出できなかった（前単位で4件発生）。
  条件を**データ（純粋関数の引数と戻り値）に移す**と、同じ間違いが「テストが落ちる」形で顕在化する。
- **`ListFocus` が2値であることを利用した等価変形**: 旧 `listFocus === 'result'`（LIST 内）は
  `!isCaretInSearch` と等価。判定の意図（「検索ボックスでネイティブのテキスト操作を奪わない」）を名前にすると、
  FOLDER_TREE へ拡張したときに条件を書き換えずに済む。**条件式を「状態の列挙」ではなく「理由」で名付ける**と拡張に強い。
- **ドキュメントが実装より強い主張をしていたら、ドキュメントを直すのも正解**。design.md の
  「型エラーで気づける」は `never` を使えば実現できたが、リポジトリ内の既存 `switch`
  （`modeReducer` / `resolveKeyIntent`）がいずれも `never` を使っておらず、本単位だけ様式を変えると一貫性を欠く。
  **一貫性を壊す局所最適より、正確な記述 + 横断単位への申し送りを選んだ**。
- リファクタリングでは**旧コードとの1件ずつの突き合わせ表**が有効。「意図した差分」を先に宣言しておくと、
  レビュー（人・エージェント双方）が「それ以外に差分が無いか」だけに集中できる。

**プロセス上の改善点**:
- 前単位の申し送りに書いた改善提案（`isShortcutEnabled` の切り出し）を**次の単位で実際に実行した**結果、
  検証→戻りが 3ラウンド → 0ラウンド になった。申し送りが機能した好例。
- 計画承認（ゲート1）で**親ブランチの問題を事前に検出できた**。`create-branch` の既定は `dev` だが、
  前単位のコミットが `dev` に未マージだったため、そのまま切ると土台を失うところだった。
  **前単位に続けて積む単位では、親ブランチをステアリングの依存関係として明記する**とよい。

### 次回への改善提案
- **`Popup.tsx` に残る他の「位置依存の条件」も同じ方法で棚卸しする余地がある**。今回はショートカットのみを
  対象にしたが、`resolveKey` によるキー意味論の分岐や、パネル系の排他制御（`bulkMovePanel` /
  `addCurrentPanelOpen`）にも同種の暗黙条件が残っている。
- **`modeMachine` の全 `switch` に `never` 網羅性チェックを入れる横断単位**を検討する（下記申し送り1）。
- 既定モード・既定フォーカスのような**全体に効く前提を変更する単位**では、その前提に依存する分岐の
  棚卸しを受け入れ基準に含めると、U11 のような取りこぼしを防げる。

### 後続への申し送り（未対応事項）

1. **`switch` の `never` による網羅性チェック未導入** — `isShortcutEnabled` / `modeReducer` / `resolveKeyIntent`
   のいずれも `default` が防御的 return で、`ShortcutIntent` や `Mode` に値を追加しても型エラーにならない。
   様式を揃えるため**全 `switch` をまとめて対象にする横断単位**で扱う。導入すると「新しいショートカットを
   追加したのに有効条件を定義し忘れる」がコンパイル時に検出できるようになる。
2. **`docs/ideas/keyboard-first-navigation.md:76`** に旧仕様「端では何もしない」が残存（前単位からの継続）。
   壁打ち成果物（当時の検討記録）のため**意図的に据え置き**。永続ドキュメントは更新済みで、そちらが正。
3. **親ブランチの整理** — 本単位は `feature/list-arrow-wrap` の上に積んでいる。`dev` へは
   `feature/list-arrow-wrap` → `feature/shortcut-mode-parity` の順にマージするか、まとめて1つの PR にする必要がある。
