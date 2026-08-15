# タスクリスト

**作業単位**: `folder-ui-affordance`（フォルダ選択 UI の操作可能性の是正）
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

## フェーズ1: スクロール追従の共通フック（AC-1 / AC-2）

- [x] `pages/popup/src/hooks/useScrollSelectedIntoView.ts` を新規作成
  - [x] `useScrollSelectedIntoView(listRef, deps)` を実装（`[data-selected="true"]` を `scrollIntoView({ block: 'nearest' })`）
  - [x] JSDoc に「`MovePanel` にしか無く `AddCurrentPanel` へ移植し忘れていた」経緯と、`block: 'nearest'` を選ぶ理由（可視範囲内なら動かさない）を記す
  - [x] `deps` を引数で透過させる理由（呼び出し側で再評価タイミングが異なる）をコメントに残す
  - [x] 選択状態を「`data-selected="true"` が付く」という DOM 契約のみで受け取る旨を明記（今後の候補リストにも再利用可能）
- [x] `MovePanel.tsx` の既存 `useEffect`（L75-78）をフック呼び出しへ置き換える（**挙動は不変**。deps は `[index, filtered]` のまま）

## フェーズ2: 追加ダイアログのスクロール追従（AC-1）

- [x] `AddCurrentPanel.tsx` に追従を追加
  - [x] 候補リストのスクロールコンテナ（`max-h-[160px] overflow-y-auto`）に `folderListRef` を付与
  - [x] 候補ボタンに `data-selected={i === folderIndex}` を付与（選択状態を DOM 属性に出す）
  - [x] `useScrollSelectedIntoView(folderListRef, [folderIndex, filtered])` を呼ぶ
  - [x] 絞り込み変更時に `folderIndex` が 0 へ戻る既存 effect と組み合わせて、先頭候補が可視範囲に入ることを確認（`filtered` を deps に含めているため、候補入れ替え後にも追従が再評価される）

## フェーズ3: 左ペイン chevron の視認性と操作可能性（AC-3 / AC-4 / AC-5）

- [x] `FolderTreeItem.tsx` のフォルダ行の構造を変更
  - [x] chevron ボタンとフォルダ名ボタンを**内側ラッパ `div`** で包む（`IndentGuides` は塗りの外に残す）
  - [x] 名前ボタンに付いていた背景・角丸・フォント・`hover:bg-accent-bg`・`dropTarget` の outline を内側ラッパへ移す
  - [x] ~~`data-folder-id` は名前ボタンに残す~~ → **実装時に訂正: 内側ラッパへ移した**。`dropTarget` のハイライトをラッパに移した以上、当たり判定も同じ要素に置かないと「光っている範囲より落とせる範囲が狭い」不整合が出る（`closest('[data-folder-id]')` は上方向へ辿るため chevron 上でもヒットする）。design.md にも訂正を記録済み
  - [x] 行高 30px・`gap-[6px]`・`px-1.5` を維持（ラッパへ移しただけで数値は不変）
  - [x] ホバー（`hover:bg-accent-bg`）がラッパ側になったことで、行のどこにホバーしても行全体が反応するようになった（従来は名前部分のみ）
- [x] `FolderTreeItem.tsx` の chevron に常時の操作可能性を与える
  - [x] `scopedStrong`: `text-white/75` → `text-white` + 静止 `bg-white/20` + `hover:bg-white/35`
  - [x] `scopedMuted`: `text-accent-strong` + 静止 `bg-accent/15` + `hover:bg-accent/25`
  - [x] 非スコープ行は従来どおり（背景なし・`text-triangle`・`hover:bg-accent-bg`）
  - [x] `title={expanded ? t('popupTreeCollapse') : t('popupTreeExpand')}` を追加（既存 i18n キーを再利用）
  - [x] 子なしフォルダの空枠（`size-5`）が従来どおりインデントを揃えることを確認
- [x] 「すべて」行・「さらに N 件…」行に変更が及んでいないことを確認する（いずれも単一ボタンで塗りが完結しており本問題は起きないため未変更）

## フェーズ4: 品質チェックと修正（AC-6）

> **フォアグラウンドで実行し exit code を必ず確認する**（バックグラウンド実行では turbo が失敗しても exit 0 を返すことがある）。

- [x] `implementation-validator` サブエージェントによる品質検証を実施し、指摘に対応する
  - 総合 **4.6/5**（コード品質・セキュリティ・パフォーマンス 5 / スペック準拠 4（AC-7 が未実施のため）/ テスト 4）。**重大な問題なし**
  - 裏取りされた点: `registerRef` は行の最外 div のままで `FolderTree` のスクロール追従に影響なし / アクセシビリティ属性（`role="treeitem"` / `aria-selected` / `aria-current` / `aria-expanded`）はすべて位置不変 / Tailwind の `bg-white/20`・`bg-accent/15` は `tailwind.config.ts` の定義から正しく解決される / `MovePanel` の置き換えは deps・タイミングとも旧実装と完全同一（AC-2）
  - **[推奨] AC-7 ドキュメント未実施** → 本タスクリストのフェーズ6（ゲート2 後・モード4）に配置しているため想定内
  - **[提案1] `dropTarget` のハイライト範囲とドロップ判定範囲の不一致** → **エージェント起動後の自己レビューで既に修正済み**（`data-folder-id` をラッパへ移設）。エージェントが読んだのは修正前の状態。提案は「ラッパにも重複して付ける」だったが、**ラッパのみに置くほうが一箇所で明快**なためその形を維持する
  - **[提案2] ドロップダウンを閉じて開き直すと追従しないケース** → **対応済み**。`Escape` で閉じても `folderIndex` はリセットされないため、クエリを変えずに開き直すと deps が不変で effect が再実行されず、選択が可視範囲外のまま表示されうる。`folderOpen` を deps に追加して開閉のたびに再評価させた（`MovePanel` はパネルごと unmount されるためこの経路が無い）
  - **[提案3] `deps` 透過設計と `exhaustive-deps` 無効化** → 妥当との評価。呼び出し箇所が増えた場合の単体テスト運用は申し送りに記録
  - **[環境要因] `pnpm test` の初回フレーク** → `@extension/shared` の Vite 依存解決が turbo の並列実行時にまれに失敗する既知クラス。再実行で 209 件全通過。前単位の検証でも同じ事象が観測されており、本実装とは無関係
- [x] すべてのテストが通ることを確認
  - [x] `pnpm test` → **REAL_EXIT 0**（13 tasks / popup 209・shared 129・storage 70・chrome-extension 27・i18n 16。本単位はモデル層に触れないため件数は前単位から不変で正常）
- [x] リントエラーがないことを確認
  - [x] `pnpm lint`（`--continue` のため各パッケージの結果と最終 exit code を確認）→ **REAL_EXIT 0**（12 tasks successful）
- [x] 型エラーがないことを確認
  - [x] `pnpm type-check` → **REAL_EXIT 0**（11 tasks successful）
- [x] ビルドが通ることを確認
  - [x] `pnpm build` → **REAL_EXIT 0**（13 tasks successful）
- [x] 追加: 提案2 の修正後の再ゲートを、**パイプを使わない形**（`> file 2>&1; echo $?`）で実行し実 exit code を確認する
  - validator が `pnpm lint 2>&1 | tail -100; echo "EXIT:$?"` で `$?` が `tail` の終了コードを拾い、turbo の失敗（`ERROR run failed: command exited (1)`）が `EXIT:0` に見える事象を実際に踏んだと報告したため。
    [[turbo-gate-foreground]] の教訓の**パイプ版**にあたる。（当方が使っていた zsh の `${pipestatus[1]}` は先頭コマンド＝`pnpm` の終了コードを指すため測定自体は正しかったが、より誤りようのない形へ統一した）

## フェーズ5: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。
> **本単位は見た目の問題が中心で自動テストで検証できない**ため、実機確認がゲート2 の主たる担保になる。

- [x] 受け入れ基準（requirements.md の AC-1〜AC-7）と実装を突き合わせ OK/NG を一覧化

| AC | 内容 | 判定 | 根拠 |
|---|---|---|---|
| AC-1 | 追加ダイアログの候補が `↑↓` で追従 | ✅ OK（**要実機確認**） | `folderListRef` + `data-selected` + `useScrollSelectedIntoView(…, [folderIndex, filtered, folderOpen])`。`block:'nearest'` で可視範囲内なら動かさない。閉じ→開き直しの経路も validator 提案2 の対応で塞いだ |
| AC-2 | `MovePanel` の既存挙動が不変 | ✅ OK | 置き換えは `useScrollSelectedIntoView(listRef, [index, filtered])` のみで deps・タイミングとも旧実装と同一（validator が独立に確認）。前単位の `onMouseMove` も未変更 |
| AC-3 | スコープ中フォルダの chevron が視認できる | ✅ OK（**要実機確認**） | accent 塗りを chevron を含む内側ラッパへ移動（design mock L61 と同じ構造）。`text-white/75` → `text-white` |
| AC-4 | chevron が「押せる」と分かる | ✅ OK（**要実機確認**） | 静止状態でも `bg-white/20`（muted は `bg-accent/15`）のピル。ホバーで `bg-white/35` / `bg-accent/25`。`title` 属性を追加 |
| AC-5 | 既存の操作・レイアウトが壊れない | ✅ OK | 押下対象の分離・`preventFocusSteal`・行高 30px・`IndentGuides`・子なし空枠・「すべて」/「さらに N 件…」行はいずれも不変。`registerRef` は最外 div のまま。アクセシビリティ属性も位置不変（validator が裏取り）。D&D は `data-folder-id` をラッパへ移し、**ハイライト範囲と当たり判定を一致させた**（実装時の自己修正） |
| AC-6 | 品質ゲート | ✅ OK | `type-check` / `lint` / `test` / `build` すべて **REAL_EXIT 0**（パイプなしで測定） |
| AC-7 | ドキュメント整合（デザイン非採用項目 #12） | ⏳ 未実施 | 本タスクリストのフェーズ6（ゲート2 後・モード4）に配置。承認後に実施 |

- [x] ユーザーに実機検証を依頼（AC-3/AC-4 は目視でしか判定できない旨を明示する）
- [x] 受け入れ承認（ゲート2）を取得 → **2026-08-15 承認（1ラウンドで通過。検証→戻りは発生せず）**
  - NG があった場合は「検証ログ」に記録し、原因分類(A/B/C)に応じて戻る

## フェーズ6: ドキュメント更新・振り返り（モード4・AC-7）

- [x] `docs/functional-design.md`「デザイン非採用項目」に #12 を追記する
  - [x] README の「三角は `rgba(255,255,255,0.75)`・背景なし」に対し、**不透明の白 + 常時の半透明ピル**を採用する旨と理由（design mock は三角と名前が1つの `div` で押下対象が行全体だったが、U11 で2つのボタンへ分離した結果、三角がホバー時にしか手掛かりを出さなくなった）
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

**なし**（ゲート2 を1ラウンドで通過）。

ただし**ゲート2 に至る前に、自己レビューと validator で2件の欠陥を捕まえて修正している**（いずれもユーザーに提示する前に解消）。

1. **`dropTarget` のハイライト範囲とドロップ判定範囲の不一致**（自己レビューで検出）— design.md の当初判断
   「`data-folder-id` は名前ボタンに残す」が、ハイライト outline をラッパへ移した時点で誤りになっていた。
   光る範囲より落とせる範囲が狭くなるため、`data-folder-id` もラッパへ移した。**design.md にも訂正を記録**。
2. **ドロップダウンを閉じて開き直すと追従しない**（validator の提案2）— `Escape` で閉じても `folderIndex` は
   リセットされないため、クエリを変えずに開き直すと deps が不変で effect が再実行されない。`folderOpen` を deps に追加。

---

## 実装後の振り返り

### 実装完了日
2026-08-15（ゲート2 受け入れ承認）

### 計画と実績の差分

**計画と異なった点**:
- **`data-folder-id` の配置方針を実装中に訂正した**。design.md は当初「名前ボタンに残す（当たり判定範囲を変えない）」
  としていたが、`dropTarget` のハイライト outline を内側ラッパへ移した時点でこの判断は破綻していた
  （光る範囲 > 落とせる範囲 になる）。**ハイライトと当たり判定は同じ要素に置く**が正しく、ラッパへ移設した。
- validator の提案2 を受け、`useScrollSelectedIntoView` の deps に `folderOpen` を追加した（下記）。

**新たに必要になったタスク**:
- `AddCurrentPanel` の「閉じて開き直したとき追従しない」経路への対応（deps に `folderOpen` を追加）。
- 品質ゲートの測定方法をパイプなしの形へ統一し直す作業（下記「学んだこと」）。

**技術的理由でスキップしたタスク**: なし（全タスク完了）

### 検証の要約（モード3）

- 検証→戻りのラウンド数: **0**（ゲート2 を1ラウンドで通過）
- ただしゲート2 到達**前**に2件の欠陥を捕捉・修正済み（検証ログ参照）。1件は自己レビュー、1件は validator。
- `implementation-validator`: **総合 4.6/5**、重大な問題なし。
- 品質ゲート: `type-check` / `lint` / `test` / `build` すべて **REAL_EXIT 0**（パイプなしで測定）
- 受け入れ承認: 2026-08-15

### 学んだこと

**技術的な学び**:
- **「同じ実装が2箇所に必要な処理」は、片方だけ移植し忘れる**。`AddCurrentPanel` は `movePanelModel` を
  `MovePanel` から再利用しながら、スクロール追従だけが移植されていなかった。テストでは防げない種類の欠落で、
  **共通化（`useScrollSelectedIntoView`）でしか構造的に防げない**。
- **「見た目の属性」と「当たり判定の属性」は同じ要素に置く**。`dropTarget` の outline をラッパへ移したのに
  `data-folder-id` を子に残すと、光る範囲と落とせる範囲がずれる。**片方だけ動かした時点で不整合になる**ため、
  DOM 構造を変えるときは「この要素に付いている属性の役割」を一つずつ棚卸しする必要がある。
- **アフォーダンスはホバーだけに載せられない**。U11 の AC-8 は「ホバー背景を持つボタン」で押下可能性を表現したが、
  **キーボード操作中はホバーが発生しない**ため手掛かりがゼロになる。キーボード完結を掲げる UI では、
  押下対象は**静止状態でも**それと分かる必要がある。
- **デザインモックからの逸脱は、構造を変えた瞬間に静かに生まれる**。design mock の「三角は白75%」は
  「三角が塗りの内側にある」ことが前提だったが、U11 で1つの `div` を2つの `button` へ割った際に
  塗りの範囲が縮み、前提だけが失われた。**モックの数値を写すときは、その数値が成立する構造ごと写す**。
- **`| tail` は exit code を隠す**。validator が `pnpm lint 2>&1 | tail -100; echo "EXIT:$?"` で
  turbo の失敗（`ERROR run failed`）を `EXIT:0` と誤認する事象を踏んだ。[[turbo-gate-foreground]] の
  「フォアグラウンドで実行する」に加え、**パイプを挟むなら `${pipestatus[1]}`（zsh）を使うか、
  ファイルへリダイレクトして `$?` を見る**必要がある。本単位の最終ゲートは後者へ統一した。

**プロセス上の改善点**:
- **自己レビューで1件、validator で1件**と、ゲート2 到達前に2件の欠陥を捕まえられた。特に前者は
  「実装後に design.md の判断を読み返す」ことで見つかっており、**計画と実装の突き合わせを実装直後に行う**のが有効。
- 見た目の問題は自動テストで検証できないため、ゲート2 の依頼文で**何をどう目視すべきか**を具体的に列挙した
  （追加ダイアログ3点 / 左ペイン3点 / 回帰3点）。曖昧な「確認してください」より手戻りが減る。

### 次回への改善提案
- **DOM 構造を変える変更では、その要素が担っている役割を棚卸ししてから着手する**（見た目 / 当たり判定 /
  アクセシビリティ属性 / ref / data-* 属性）。今回の `data-folder-id` は棚卸し漏れだった。
- **押下対象を分離する変更（U11 のような）を行うときは、分離後に「それぞれが単独で押せると分かるか」を
  受け入れ基準に入れる**。U11 は分離自体は正しかったが、分離後のアフォーダンスの検証が抜けていた。
- 品質ゲートは `> file 2>&1; echo $?` の形で実行し、実 exit code を確実に読む。

### 後続への申し送り（未対応事項）

1. **`useScrollSelectedIntoView` の単体テスト** — validator の提案3。呼び出し側が deps を渡す契約は
   `exhaustive-deps` で静的検証できない（フックの `deps` を透過する構造上の制約）。呼び出し箇所が
   3箇所以上に増えるようなら、`renderHook` 等で deps 変化時の呼び出し回数を検証する運用を検討する。
2. **`AliasEditor` の候補リスト** — 同じ形の候補リストだが今回はスコープ外。追従が必要かは未確認。
   必要なら `useScrollSelectedIntoView` をそのまま適用できる（`[data-selected="true"]` を付けるだけ）。
3. **`pnpm test` の初回フレーク** — `@extension/shared` の Vite 依存解決が turbo の並列実行時にまれに失敗する。
   前単位・本単位の validator がいずれも観測（再実行で解消）。再発が続くようなら turbo の並列度か
   vite の `optimizeDeps` 設定を見直す余地がある。
4. **`switch` の `never` 網羅性チェック**（前単位からの継続）と **`docs/ideas/keyboard-first-navigation.md:76`
   の旧仕様**（意図的に据え置き）。
5. **ブランチのマージ順** — `feature/list-arrow-wrap` → `feature/shortcut-mode-parity` →
   `feature/folder-ui-affordance` の3本が直列。`dev` へは順にマージするか、最後の1本でまとめて PR にする。
