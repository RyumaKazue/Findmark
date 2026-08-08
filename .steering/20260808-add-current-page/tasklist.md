# タスクリスト — U14 add-current-page

## データ層（packages/storage）
- [x] T1. `BookmarkService.findByUrl(url)` を実装する（`chrome.bookmarks.search({url})` ラップ）

## モードヘルパ（pages/popup/src/hooks）
- [x] T2. `modeMachine.resolveShortcutIntent` に `'add-current'`（Ctrl/Cmd+D）を追加し `modeMachine.test.ts` を更新する

## フック（pages/popup/src/hooks）
- [x] T3. `useAddCurrent.ts` を実装する（open/updateTitle/updateFolder/updateAliases/remove/reset。rowActions への委譲・疑似SearchResultItem組み立て）

## UI コンポーネント（pages/popup/src/components）
- [x] T4. `AddCurrentPanel.tsx` を実装する（タイトル入力・フォルダ選択(movePanelModel再利用)・AliasEditor埋め込み・★登録済みバッジ・削除/完了ボタン・actionsRef）
- [x] T5. `SearchHeader.tsx` に `onAddCurrent` prop を追加し「＋追加」ボタンへ配線する

## 結線（Popup）
- [x] T6. `Popup.tsx` に `useAddCurrent` を結線し、`addCurrentPanelOpen` フラグ（bulkMovePanel と同型）を追加する
- [x] T7. `Popup.tsx` の document keydown ハンドラに `add-current` ショートカット（Ctrl+D）と PANEL 分岐（addCurrentPanelOpen 時の Escape=close）を追加する
- [x] T8. `Popup.tsx` に `AddCurrentPanel` の描画条件・自動クローズ effect・エラートースト分岐を追加する

## 検証
- [x] T9. `pnpm test` / `pnpm lint` / `pnpm type-check` を通す

## 検証ログ

### 実装検証（implementation-validator・ラウンド1・2026-08-08）
- **指摘1（Blocker）**: `AddCurrentPanel` にフォーカストラップが無く、Tab/Shift+Tab で背景の結果行ボタンへ
  実DOMフォーカスが漏れうる。その状態で Enter を押すとネイティブのボタン活性化で背景のブックマークが
  誤って開いてしまう（U12 で経験した「背景の結果行が Enter/Escape を奪う」不具合クラスの再発）。
  → **対応**: `AddCurrentPanel` のダイアログ `<div>` に一般的なモーダルのフォーカストラップ（Tab/Shift+Tab を
  最初/最後の要素でラップし、パネル外の要素にフォーカスが逃げないようにする）を実装。
- **指摘2（Major）**: `useRowActions` の `commitEdit`/`moveRow`/`deleteRow` は失敗時に内部で `catch` し
  `setError` した上で正常終了（例外を投げない）するため、`useAddCurrent` の `updateTitle`/`updateFolder`/
  `remove` が失敗時も無条件に `entry` を楽観的に更新・`null` 化していた。削除失敗時にパネルが誤って
  閉じる（ブックマークは実際には残っているのに見た目だけ完了したように見える）等、実データとUIが乖離しうる。
  → **対応**: `commitEdit`/`moveRow`/`deleteRow` に `Promise<boolean>`（成功/失敗）の戻り値を追加
  （既存の `void rowActions.X(...)` 呼び出し側は非破壊）。`useAddCurrent` はこれを見てから `entry` を更新する。
- **指摘3（Minor）**: `open()` の `try` が `getCurrentTab()` を保護しておらず、失敗時に unhandled rejection
  になりうる。→ **対応**: `try` ブロックを `getCurrentTab()` から開始し、空URL時は専用メッセージを出す。
- **指摘4（Minor）**: `lastUsedFolderId` のフォールバック判定が `folders`（FolderTree読み込み前は空配列）に
  依存しており、ポップアップ起動直後に Ctrl+D を押すと前回フォルダを「削除済み」と誤判定しうる。
  → **対応**: `handleOpenAddCurrent` に `foldersLoaded` ガードを追加。
- **指摘5（Minor/ドキュメント相違）**: design.md は `AliasEditor` の `onClose={noop}` を想定していたが、
  実装は `onClose={onClose}`（パネル全体を閉じる）にしていた。→ **対応**: design.md を実装に合わせて更新
  （`noop` だと別名欄の Escape で何も起きず抜け出せない手詰まりになるため、実装側の判断を正とした）。
- **再検証**: `pnpm test`(170件 all green) / `pnpm type-check` / `pnpm lint` すべて exit 0（前景確認）。

### 受け入れ承認（2026-08-08）
承認。NG なし。

## 申し送り事項（振り返り・2026-08-08）

- **実装完了日**: 2026-08-08
- **計画と実績の差分**:
  - 計画どおり全9タスク（T1〜T9）を実装。実装検証（implementation-validator）で1件の Blocker（フォーカス
    トラップ欠如）・1件の Major（破壊的操作の失敗検知）を受け、計画外の追加修正を行った。
  - **`useRowActions` の公開契約変更**: `commitEdit`/`moveRow`/`deleteRow` に成功/失敗を示す `Promise<boolean>`
    戻り値を追加した。これは U10/U12 で確立済みのAPIへの後方互換な拡張（既存の `void rowActions.X(...)`
    呼び出しは無変更で動作）だが、「破壊的操作は失敗を握りつぶして正常終了する」という既存の暗黙の設計が
    U14 で初めて問題として顕在化した点は、計画時点では想定していなかった。
  - **PANEL モード共用パターンの3例目**: U13 の `bulkMovePanel` に続き、U14 でも `addCurrentPanelOpen` という
    同型のフラグで既存 `PANEL` モードを共用した。`Mode`/`modeReducer`/`resolveKeyIntent` は3単位連続で
    無改修のまま新機能を追加できており、この設計判断（U13 の振り返りで決定）の再現性が確認できた。
- **学んだこと**:
  - **「エラーを握りつぶして正常終了する」関数は、呼び出し側が結果に応じて分岐する設計とは根本的に相性が
    悪い**。U10/U12 時点では「エラートーストを出すだけで十分」（呼び出し元は結果を気にせず `void` で
    投げっぱなし）だったが、U14 のように「削除が成功したらパネルを閉じる」といった**結果に応じた後続処理**
    を持つ呼び出し元が現れた時点で、この設計は不十分になった。今後、既存の「投げっぱなし」関数を新しい
    文脈で再利用する際は、常に「呼び出し元が成功/失敗を区別する必要はないか」を確認する。
  - **MovePanel と同じ「背景オーバーレイ構造」を持つ新しいパネルは、MovePanel の Escape 修正だけでは
    不十分**な場合がある。MovePanel は単一入力欄だったため「Tab で常にその入力欄へ戻す」で足りたが、
    複数フィールドを持つフォーム型パネル（AddCurrentPanel）では汎用的なフォーカストラップが必要になる。
    次に同種のオーバーレイパネルを作る際は、最初から「フィールド数に応じた適切なフォーカス閉じ込め方式」を
    design.md で明示的に検討する。
- **次回への改善提案**:
  - U15（インポート/エクスポート）・U16（ゴミ箱）でも `useRowActions` 相当の委譲を検討する場合、今回
    追加した `Promise<boolean>` 戻り値の契約を踏襲する。
  - `useRowActions`/`useAddCurrent` はいずれも直接ユニットテストを持たない方針を継続しているが、
    「失敗時の状態遷移」のような組み合わせロジックはテストが無いと実装検証まで発見できないことが
    U13（`bulkActionsCore`）・U14（今回）と2回続けて起きている。次の同種単位では、着手前に
    「失敗パスをテストするかどうか」を design.md で明示的に決めることを推奨する。
