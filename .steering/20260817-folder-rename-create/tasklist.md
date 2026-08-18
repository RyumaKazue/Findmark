# タスクリスト — folder-rename-create

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース
実装方針・アーキテクチャ・依存関係の変更により、タスク自体が技術的に不要/実行不能になった場合のみ。
スキップ時は `- [x] ~~タスク名~~（理由: 具体的な技術的理由）` の形式で記録する。

---

## フェーズ1: 純粋モデル（`folderMenuModel`）

- [x] `pages/popup/src/components/folderMenuModel.ts` を新規作成する
  - [x] `FolderMenuKey` = `'create' | 'rename' | 'delete'` を定義する
  - [x] `FolderMenuItemSpec` / `FolderMenuContext`（`isTopLevel`）を定義する
  - [x] `buildFolderMenuItems(ctx)`: 並びは create → rename → delete、`delete` に `danger` + `separatorBefore`
  - [x] 最上位フォルダでは `rename` / `delete` を `disabled` にし、`create` は有効のままにする
  - [x] `validateFolderTitle(raw)`: trim 後が空なら `popupErrorFolderNameRequired`。同名チェック・文字数上限は設けない旨をコメントに残す
  - [x] `planRename(originalTitle, raw)`: `invalid` / `unchanged` / `update`（`inlineEditModel.planCommit` と同じ形）
  - [x] 宣言は非 export・ファイル末尾で export をまとめる（既存 pure module の規律）
- [x] `pages/popup/src/components/folderMenuModel.test.ts` を新規作成する
  - [x] `buildFolderMenuItems`: 通常フォルダ（3項目・並び順・danger/区切り線）
  - [x] `buildFolderMenuItems`: 最上位フォルダ（rename/delete が disabled・create は有効）
  - [x] `validateFolderTitle`: 空 / 空白のみ / 前後空白あり / 通常名 / `/` を含む名前
  - [x] `planRename`: 変更あり（trim される）/ 変更なし / 前後空白だけの差 / 空名

## フェーズ2: i18n

- [x] `packages/i18n/locales/ja/messages.json` に10キーを追加する
  - [x] `popupFolderMenuCreate` / `popupFolderMenuRename` / `popupFolderMenuRenameDisabled`
  - [x] `popupFolderRenameTitle` / `popupFolderCreateTitle` / `popupFolderNameLabel` / `popupFolderCreateAction`
  - [x] `popupErrorFolderNameRequired` / `popupErrorFolderRenameFailed` / `popupErrorFolderCreateFailed`
- [x] `packages/i18n/locales/en/messages.json` に同じ10キーを追加する（キー順を ja と揃える。152キーで一致を確認）
- [x] 既存キーの流用を確認する（確定=`commonSave` / 取りやめ=`commonCancel`）

## フェーズ3: フォルダ操作（`useFolderActions`）

- [x] `renameFolder({ id, title })` を追加する
  - [x] `bookmarkService.rename` → 失敗時はエラートースト・`false` を返し索引/左ペインに触れない
  - [x] 成功時に `reloadIndex()`（配下全エントリの `folderPath`/`nFolders` が波及するため）→ `reloadFolders()`
  - [x] `reloadIndex` の失敗はログのみで成功扱いにする理由をコメントに残す
- [x] `createFolder({ parentId, title })` を追加する
  - [x] `bookmarkService.create` → 失敗時はエラートースト・`null` を返す
  - [x] ~~成功時は `reloadFolders()` のみ（空フォルダは索引に載らない）~~（設計修正: 作成後も `reloadIndex()` する。`SearchEngine.folderIdPaths` に新フォルダが載らないと、そこへ移動したブックマークの ID パス解決がフォールバックに倒れ、祖先スコープで出なくなるため）
  - [x] 作成した ID を返す
- [x] `UseFolderActionsApi` の doc コメントを更新する（5秒アンドゥを登録しない理由を明記）

## フェーズ4: 入力ダイアログ（`PromptDialog`）

- [x] `pages/popup/src/components/PromptDialog.tsx` を新規作成する
  - [x] props: `title` / `inputLabel` / `initialValue` / `selectOnFocus` / `confirmLabel` / `onConfirm` / `onCancel` / `actionsRef`
  - [x] `PromptDialogActions`（`confirm` / `close` のみ。候補移動を持たない理由をコメントに残す）を定義・export する
  - [x] `ConfirmDialog` と同じ構成（暗幕付き背景オーバーレイ・命令ハンドル・`role="dialog"`）にする
  - [x] マウント時に入力欄へフォーカスし、`selectOnFocus` のときは全選択する
  - [x] 入力欄の `onKeyDown` で `Enter`=確定 / `Escape`=取りやめを処理し `stopPropagation` する
  - [x] `e.nativeEvent.isComposing` のときは何もしない（変換確定の Enter で閉じない = AC-9）
  - [x] 空・空白のみのときは確定ボタンを `disabled` にし、`confirm()` も no-op にする
  - [x] 入力値はトリムせず生の値を `onConfirm` へ渡す（トリムの責務は呼び出し側）

## フェーズ5: 結線（`Popup.tsx`）

- [x] `ContextAction` に `folder-prompt` variant を追加する（`intent` / `folderId` / `title`）
- [x] `promptDialogActionsRef` を追加する
- [x] フォルダメニューの JSX 直書き項目を `buildFolderMenuItems` + ラベル表へ差し替える
  - [x] `folderMenuLabels` / 無効理由の文言（`rowMenuLabels` と同じ形）を用意する
  - [x] 既存の `deletable`（`depth > 0`）を `isTopLevel`（`depth === 0`）へ移し替え、判定の意味を変えない
- [x] `handleFolderMenuSelect` を3分岐（`create` / `rename` / `delete`）にする
  - [x] `create` / `rename` は `folder-prompt` へ差し替える（PANEL のまま）
  - [x] `delete` は既存処理をそのまま維持する
- [x] `handleFolderPromptConfirm` を実装する
  - [x] `rename`: `planRename` → `unchanged` は API を呼ばず閉じるだけ（AC-8）/ `update` は `renameFolder`
  - [x] `create`: `validateFolderTitle` が ok のときのみ `createFolder`
  - [x] 作成成功後に親を `expand(parentId)` し、`setScopeFolderId(newId)` でスコープを移す
- [x] PANEL のキー配線を3分岐にする（`folder-confirm` / `folder-prompt` / それ以外）
  - [x] `folder-prompt` では `↑↓` / `←→` を何にも割り当てない（入力欄のカーソル移動を潰さない）
- [x] `PromptDialog` の描画条件（`mode.mode === 'PANEL' && contextAction?.kind === 'folder-prompt'`）を追加する
- [x] 既存の排他条件（`contextAction === null`）に変更が不要であることを確認する

## フェーズ6: 品質チェックと修正

- [x] `pnpm test`（フォアグラウンド実行で exit code 0。13/13 tasks・popup は 259 → 277 tests）
- [x] `pnpm lint`（`--continue` のため各パッケージの結果と最終 exit code を確認。12/12・exit 0）
- [x] `pnpm type-check`（exit code 0・11/11）
- [x] `implementation-validator` サブエージェントによる品質検証を実施し、指摘を解消する
  - [x] 総合 4.8/5・重大な問題なし。[推奨]2件・[提案]1件の指摘を受領
  - [x] 指摘1（rename 分岐で `invalid` 到達時にもダイアログが閉じ、create 分岐と非対称）→ `invalid` は閉じずに return するよう修正
  - [x] 指摘2（`useCallback` の依存に `t` を含む）→ 既存 `deleteFolder` と同じ既存パターンのため対応不要と判断
  - [x] 提案1（`planRename` の元の名前が空白のみのケース）→ テストを1件追加（278 tests）

## フェーズ7: 検証（モード3）

> 全タスク`[x]`は「作りきった」だけ。ここで「想定通りか」を判定する。

- [x] requirements.md の AC-1〜AC-12 と実装を突き合わせ OK/NG を一覧化する
- [x] 手動確認の観点をチェックリストとして提示する
- [x] ユーザーに検証結果を提示し、受け入れ承認（ゲート2）を取得する
  - NG は無く「受け入れてフェーズ8へ」で承認された（2026-08-17）

## フェーズ8: ドキュメント更新・振り返り（モード4）

- [x] `docs/product-requirements.md` 機能5 にフォルダの名前変更・新規作成の受け入れ条件を追記する
- [x] `docs/functional-design.md` に UC-5c（フォルダの名前変更・新規作成）を追記し、操作表を更新する
  - [x] UC-5b の直後に UC-5c（メニュー図・シーケンス図・整合ルール）を追加
  - [x] 左ペインの節に「フォルダの操作導線」表を新設（結果行の導線表と対になる形）
- [x] 本ファイル下部に振り返りを記録する

---

## 検証ログ

> 検証→戻る（モード3）が発生するたびに追記する。発生しなければ「なし」。

**なし**（1ラウンドで AC-1〜AC-12 すべて OK。分類 A/B/C いずれの戻りも発生しなかった）。

---

## 実装後の振り返り

### 実装完了日

2026-08-17

### 計画と実績の差分

**差分1: `createFolder` でも検索索引を作り直すことにした（実装中に判明・design.md 134-139行に記録）**

計画では「空フォルダは索引に載らないので `createFolder` は索引に触れない」としていた。実装中に `SearchEngine` が索引エントリとは**別に** `folderIdPaths`（フォルダ ID → 祖先 ID パス）を `loadIndex` 時に構築していることを確認し、これが `moveNode`/`addNode` の ID パス解決に使われるため、新規フォルダがこの表に無いと `resolveFolderIdPath` がフォールバック（`[folderId]` の1要素パス）へ倒れると分かった。結果として「作った直後のフォルダへブックマークを移すと、祖先フォルダをスコープにしたときにそのブックマークが出ない」という不具合になる（`folder-scope-descendants` の配下判定は ID パスの包含で行うため）。作成後も `reloadIndex` する形へ変更した。

**差分2: `implementation-validator` の指摘で rename/create の非対称を解消**

`handleFolderPromptConfirm` の rename 分岐は、`planRename` が `invalid` を返した場合にもダイアログを閉じていた（create 分岐は閉じずに return）。現状 `PromptDialog` の `canConfirm` が空入力を弾くため到達しないが、将来 UI 側の判定が変わったときに「何も更新していないのにダイアログだけ消える」挙動になる。`invalid` では閉じない形へ揃えた。

**差分なし（計画どおり）だった主な点**:
- 新規作成は `folderMenuModel.ts` と `PromptDialog.tsx` の2ファイルのみ。データ層（`packages/storage`）と検索（`packages/shared`）は無変更で完了した（`BookmarkService.rename`/`create` が U10/U14 で既に揃っていた）。
- `ContextAction` ユニオンへ variant を1つ足すだけで済み、**既存の排他条件（`contextAction === null`）は1項も増えなかった**（`folder-delete` がユニオン化しておいた設計意図がそのまま効いた）。

### 検証の要約（モード3）

- ラウンド数: **1**（戻りなし）
- AC-1〜AC-12 をすべて OK と判定。品質ゲートは test 13/13（popup 278 tests・うち `folderMenuModel.test.ts` 19 tests）・lint exit 0・type-check exit 0。
- `implementation-validator`: 総合 4.8/5・重大な問題なし。[推奨]2件・[提案]1件のうち2件を反映、1件（`useCallback` の依存に `t` を含む）は既存パターンの踏襲のため対応不要と判断した。

### 学んだこと

- **「索引に載らないから索引に触れなくてよい」は早計だった**。`SearchEngine` は「検索対象のエントリ」と「スコープ判定を助ける補助表（`folderIdPaths`）」の2つの状態を持っており、後者はフォルダの増減にも反応する必要がある。索引更新の要否は「エントリが増減するか」ではなく「エンジンが持つ**どの状態**が変わるか」で判断すべきだった。直前の単位（`folder-scope-descendants`）で入れた仕組みが、次の単位の判断材料になっていることに実装中まで気づけなかった。
- **申し送りが機能した**。`folder-delete` の design.md が「`ContextMenu` は項目配列駆動のため、リネーム・新規作成を項目追加だけで足せる」と書き残していたため、本単位は設計の大半を「その通りに実装する」だけで済んだ。同様に「PANEL の共存フラグを `panelKind` へ統合すべき」という申し送りは今回も回収しなかったので、そのまま次へ引き継ぐ。
- **`PromptDialog` を汎用として作った判断は妥当だった**。名前変更と新規作成で見出し・初期値・確定ラベル・全選択の有無だけが違い、コンポーネントを2つ作る理由が実際に無かった。

### 次回への改善提案

- **`SearchEngine` の状態一覧を design か mental-model に1箇所へ書き出す**。`entries` と `folderIdPaths` の2状態があり、それぞれ「どの操作で更新が必要か」の対応表があれば、今回の見落としは計画段階で防げた。
- **`PANEL` の共存フラグ統合（`bulkMovePanel` / `addCurrentPanelOpen` / `contextAction` → 単一の `panelKind` ユニオン）を独立した単位として切る**。`folder-delete` から2単位連続で「既存2つには触れない」と判断して見送っており、次に PANEL 用途を足す前に片付けるべき負債になっている。
- **フォルダ操作のショートカット（`F2` 等）の要否を検討する**。本単位は右クリックメニューを唯一の導線としたが、Findmark は「キーボードだけで完結する操作体系」を掲げている。左ペインにフォーカスがあるときの `F2`＝名前変更は `modeMachine.isShortcutEnabled` の整合を確認したうえで別単位として検討する価値がある。
