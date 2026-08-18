# 設計書 — folder-rename-create

## アーキテクチャ概要

既存の3層（純粋モデル → React フック → UI）と、`Popup.tsx` の単一 document リスナー方式をそのまま踏襲する。**新しいモード・新しい状態管理機構・新しいデータ層メソッドをいずれも増やさない。**

```
BookmarkService (データ層)         ── rename / create は実装済み。**拡張なし**
        │
folderMenuModel.ts (純粋・新規)    ── メニュー項目の並びと無効条件 / 名前のバリデーション・確定判定
        │
useFolderActions.ts (React 層)     ── renameFolder / createFolder を追加（既存 deleteFolder と同じ骨格）
        │
Popup.tsx (結線)                   ── ContextAction に `folder-prompt` を1つ追加・PANEL のキー配線を3分岐へ
        │
ContextMenu (既存) / PromptDialog (新規) / FolderTree (既存)
```

**中心となる設計判断**: `folder-delete` が残した申し送り（「`ContextMenu` は項目配列駆動のため、リネーム・新規作成を**項目追加だけ**で足せる」）どおりに実装する。したがって本単位で新規に作るのは **`folderMenuModel.ts`（純粋）と `PromptDialog.tsx`（UI）の2ファイルだけ**で、残りはすべて既存ファイルへの追記になる。

**そのうえでの整理**: フォルダメニューの項目は現在 `Popup.tsx` の JSX に直書きされている（`folder-delete` 時点で1項目だったため妥当だった）。3項目 + 無効条件 + 区切り線になる時点で、`row-context-menu` が `rowMenuModel.ts` を切り出したのと**同じ理由**（テストの当てられない場所に分岐が溜まる）が成立するため、対になる `folderMenuModel.ts` を新設する。

## コンポーネント設計

### 1. `pages/popup/src/components/folderMenuModel.ts`（新規・純粋）

既存の pure module（`rowMenuModel.ts` / `folderDeleteModel.ts`）に倣い、宣言は非 export・ファイル末尾で export をまとめる。

```ts
/** フォルダメニューの項目キー（`Popup` 側で実行を分岐する識別子）。 */
type FolderMenuKey = 'create' | 'rename' | 'delete';

/** メニュー項目の表示属性（ラベル・無効理由の文言は持たない。i18n は呼び出し側が `key` から引く）。 */
interface FolderMenuItemSpec {
  key: FolderMenuKey;
  danger?: boolean;
  separatorBefore?: boolean;
  /** 選べない項目か（フォーカスはできるが実行されない）。 */
  disabled?: boolean;
}

/** `buildFolderMenuItems` の判定文脈。 */
interface FolderMenuContext {
  /**
   * 最上位フォルダ（「ブックマーク バー」「その他のブックマーク」等・ツリーの depth 0）か。
   * Chrome はルート直下フォルダの `update` / `removeTree` を拒否するため、名前変更と削除を無効にする。
   * **作成は拒否されない**ため制限しない。
   */
  isTopLevel: boolean;
}

const buildFolderMenuItems = (ctx: FolderMenuContext): FolderMenuItemSpec[]

/** フォルダ名の検証結果（`inlineEditModel.UrlValidation` と同じ形）。 */
type FolderTitleValidation = { ok: true } | { ok: false; message: LocalizedMessage };
const validateFolderTitle = (raw: string): FolderTitleValidation

/**
 * 名前変更の確定計画（`inlineEditModel.planCommit` と同じ判別可能ユニオン）。
 * `unchanged` は chrome API を呼ばずに閉じるだけ（索引の再構築も起こさない = AC-8）。
 */
type RenamePlan = { type: 'invalid' } | { type: 'unchanged' } | { type: 'update'; title: string };
const planRename = (originalTitle: string, raw: string): RenamePlan
```

**実装の要点**:
- 項目の並びは `create` → `rename` → `delete`。`delete` は `danger: true` + `separatorBefore: true`（`buildRowMenuItems` と同じ規律）。
- `validateFolderTitle` は「trim して空なら不可」だけを判定する。**同名チェックは行わない**（requirements 決定事項5）。文字数上限も設けない（Chrome 側に制限が無く、独自に切ると保存内容と表示が食い違う）。
- `planRename` は `validateFolderTitle` を先に通し、不正なら他の判定を行わず `invalid` を返す（`planCommit` と同じ順序）。
- `delete` の無効条件は現在 `Popup.tsx` の `deletable: target.depth > 0` にあり、これを本モジュールへ移す。**判定の意味は変えない**（既存挙動の非退行）。

### 2. `pages/popup/src/components/PromptDialog.tsx`（新規・汎用）

```
┌───────────────────────────────────────┐
│ 「開発」の中に新しいフォルダを作成       │
│ ┌───────────────────────────────────┐ │
│ │ フォルダ名                         │ │  ← マウント時にフォーカス（変更時は全選択）
│ └───────────────────────────────────┘ │
│              [ キャンセル ] [ 作成 ]    │
└───────────────────────────────────────┘
```

**props**: `title`, `inputLabel`, `initialValue`, `selectOnFocus?`, `confirmLabel`, `onConfirm(value: string)`, `onCancel`, `actionsRef`

```ts
/** Popup の document リスナーから呼ばれるダイアログ操作（`panel:*` インテントの実行体）。 */
interface PromptDialogActions {
  /** `panel:confirm`。入力値で確定する（空・空白のみなら何もしない）。 */
  confirm: () => void;
  /** `panel:close`。取りやめる。 */
  close: () => void;
}
```

**実装の要点**:
- `ConfirmDialog` と同じ構成（暗幕付き背景オーバーレイ + 命令ハンドル + `role="dialog"`）。文言はすべて呼び出し側から受け、フォルダ固有の知識を持たない。
- **`selectPrev`/`selectNext` を持たない**。テキスト入力に対して `↑↓` で動かす候補が無いため、`ConfirmDialogActions` と同じ型にはせず別の型として定義する（意味の無いハンドルを空実装で埋めない）。Popup 側は `↑↓` を `folder-prompt` のときだけ何にも割り当てない。
- **キーは入力欄自身が拾い、`stopPropagation` する**（`InlineEdit` / `AliasEditor` と同じ規律）。理由は日本語入力: 変換確定の `Enter` が document リスナーへ届くと、変換を確定しただけでダイアログが閉じてしまう。入力欄の `onKeyDown` で `e.nativeEvent.isComposing` を見て、変換中の `Enter` は無視する（AC-9）。
  - `actionsRef` は**入力欄にフォーカスが無い場合の保険**として公開する（背景クリック直後など DOM フォーカスが外れている経路でも `Escape` が効くようにする）。二重発火は起きない（入力欄で処理したイベントは `stopPropagation` 済みのため document へ届かない）。
- 確定ボタンは `validateFolderTitle` ではなく**汎用の空判定**（`value.trim().length === 0`）で無効化する。`PromptDialog` はフォルダ専用ではないため、フォルダ名固有の検証を持ち込まない。
- 入力値は内部 state で持ち、確定時に**トリムせず生の値**を `onConfirm` へ渡す（トリムの責務は `planRename` / `Popup` 側に置き、検証と保存値の決定を1箇所に集める）。

### 3. `pages/popup/src/hooks/useFolderActions.ts`（拡張）

既存の `deleteFolder` と同じ骨格（データ層呼び出し → 索引 → 左ペイン、失敗時は索引を触らずエラー通知のみ）で2つ追加する。

```ts
/** フォルダ名を変更する。戻り値は成功したか（`folder-rename-create`）。 */
renameFolder: (args: { id: string; title: string }) => Promise<boolean>;

/**
 * `parentId` の直下に空フォルダを作る。戻り値は作成したフォルダの ID（失敗時 null）。
 * 呼び出し側はこの ID をスコープに設定する（requirements 決定事項8）。
 */
createFolder: (args: { parentId: string; title: string }) => Promise<string | null>;
```

**手順（`renameFolder`）**:
```
1. await bookmarkService.rename(id, title)   ← 失敗 → エラートースト・return false（索引・左ペインは触らない）
2. await reloadIndex()                        ← 配下**全エントリ**の folderPath/nFolders が変わるため作り直す
3. reloadFolders()
```

**手順（`createFolder`）**:
```
1. const created = await bookmarkService.create({ title, parentId })  ← 失敗 → エラートースト・return null
2. await reloadIndex()                        ← エントリは増えないが `folderIdPaths` の更新に必要（下記）
3. reloadFolders()
4. return created.id
```

> **実装中の修正（当初計画からの変更）**: 当初は「空フォルダは索引に載らないので `createFolder` は索引に触れない」
> としていたが、`SearchEngine` は索引エントリとは**別に** `folderIdPaths`（フォルダ ID → 祖先 ID パス）を
> `loadIndex` 時に構築しており、`moveNode`/`addNode` の ID パス解決がこれを引く。作成したフォルダがこの表に
> 無いと、`resolveFolderIdPath` がフォールバック（`[folderId]` の1要素パス）に倒れる。その結果、**作った直後の
> フォルダへブックマークを移すと、祖先フォルダをスコープにしたときにそのブックマークが出ない**
> （`folder-scope-descendants` の配下判定は ID パスの包含で行うため）。よって作成後も `reloadIndex` する。

**実装の要点**:
- `renameFolder` の手順2で `reloadIndex` を使う理由は「索引エントリが**フォルダ名の正規化語**（`nFolders`）を持つ」ため。`moveNode` は移動した1エントリの `folderPath` しか差し替えられず、リネームのように配下全件へ波及する変更には使えない（`SearchEngine` に「フォルダ名だけを一括更新する」API を足す案は取らない。索引の再構築は数百 ms で、リネームは低頻度操作のため）。
- `reloadIndex` の失敗はログのみ（`deleteFolder` のアンドゥ経路と同じ扱い）。リネーム自体は成功しており、次回起動で索引は作り直される。
- 5秒アンドゥは登録しない（requirements 決定事項6）。`register` の依存は既存のまま。

### 4. `pages/popup/src/Popup.tsx`（結線）

**`ContextAction` ユニオンへ1 variant 追加**:
```ts
| {
    kind: 'folder-prompt';
    /** `rename` = `folderId` の名前を変える / `create` = `folderId` の直下に作る。 */
    intent: 'rename' | 'create';
    folderId: string;
    /** rename: 現在の名前（入力欄の初期値）/ create: 親フォルダ名（見出しの文言用）。 */
    title: string;
  }
```

| 箇所 | 変更 |
|---|---|
| メニュー項目 | JSX 直書きから `buildFolderMenuItems({ isTopLevel })` + ラベル表（`rowMenuLabels` と同じ形）へ差し替え |
| `handleFolderMenuSelect` | `switch (key as FolderMenuKey)` で3分岐。`create`/`rename` は `setContextAction({ kind: 'folder-prompt', ... })` へ差し替える（PANEL のまま。メニュー → 確認ダイアログと同じ遷移の形） |
| `handleFolderPromptConfirm` | `intent` で分岐。`rename` は `planRename` を通し `unchanged` なら閉じるだけ（AC-8）。`create` は `validateFolderTitle` が ok のときのみ実行 |
| 作成後 | `folderTreeActionsRef.current?.expand(parentId)` で親を展開し、`setScopeFolderId(newId)` でスコープを移す |
| PANEL のキー配線 | 命令ハンドルの選択を3分岐にする: `folder-confirm` → `confirmDialogActionsRef` / `folder-prompt` → `promptDialogActionsRef` / それ以外 → `contextMenuActionsRef`。`↑↓`・`←→` は `folder-prompt` では何もしない（テキスト入力に候補移動が無い） |
| 閉じる | 既存の `closeContextAction` をそのまま使う（左ペインへフォーカスを戻す挙動が `folder-prompt` にも正しく当てはまる） |
| 排他条件 | **変更なし**（`contextAction === null` の1項で足りる。ユニオンに variant を足しても条件は増えない = `folder-delete` の設計意図どおり） |

**作成後にスコープを移す順序の注意**: `FolderTree.reload()` は非同期で、`setScopeFolderId(newId)` の直後は新しいフォルダがまだ `folders` に無い。そのため祖先の自動展開 effect（`collectAncestorIds`）は初回は空振りする。これを補うために**親フォルダの展開を明示的に呼ぶ**（`expand(parentId)` は現在の木で解決できる）。木の再取得が届いた後は、既存の effect が新しい ID の祖先を解決して整合する。

### 5. i18n（`packages/i18n/locales/{ja,en}/messages.json`）

| キー | ja | en |
|---|---|---|
| `popupFolderMenuCreate` | 新しいフォルダ | New folder |
| `popupFolderMenuRename` | 名前を変更 | Rename |
| `popupFolderMenuRenameDisabled` | 最上位のフォルダは名前を変更できません | Top-level folders can't be renamed |
| `popupFolderRenameTitle` | 「$1」の名前を変更 | Rename "$1" |
| `popupFolderCreateTitle` | 「$1」の中に新しいフォルダを作成 | New folder in "$1" |
| `popupFolderNameLabel` | フォルダ名 | Folder name |
| `popupFolderCreateAction` | 作成 | Create |
| `popupErrorFolderNameRequired` | フォルダ名を入力してください | Enter a folder name |
| `popupErrorFolderRenameFailed` | フォルダ名の変更に失敗しました | Failed to rename the folder |
| `popupErrorFolderCreateFailed` | フォルダの作成に失敗しました | Failed to create the folder |

名前変更の確定ラベルは既存の `commonSave`（保存 / Save）を、取りやめは `commonCancel` を流用する。

## データフロー

### UC-A: フォルダの名前を変える
```
1. 左ペインの「chrome」を右クリック → PANEL へ入り ContextMenu 表示（3項目）
2. 「名前を変更」を Enter/クリック → contextAction を `folder-prompt`(rename) へ差し替え（PANEL のまま）
3. 入力欄に「chrome」が入り全選択された状態で開く → 「Chrome拡張」へ書き換えて Enter
4. planRename → { type:'update', title:'Chrome拡張' }
   4-1. bookmarkService.rename(id, 'Chrome拡張')
   4-2. reloadIndex()    ← 配下ブックマークの folderPath / nFolders が新しい名前になる
   4-3. reloadFolders()  ← 左ペインの表示名が変わる
5. ダイアログを閉じ、左ペインへフォーカスを戻す
   → 「Chrome拡張」で検索すると配下のブックマークがフォルダ名マッチでヒットする（AC-3）
```

### UC-B: フォルダの中に新しいフォルダを作る
```
1. 左ペインの「開発」を右クリック →「新しいフォルダ」
2. 空の入力欄で「aws」を入力 → Enter（空のままでは確定ボタンが無効・Enter も何もしない）
3. bookmarkService.create({ title:'aws', parentId:'開発の id' }) → 新しい ID
4. reloadFolders() → 「開発」を expand → スコープを新しい ID へ移す
5. 左ペインに「開発 > aws」が現れ、スコープが当たった状態になる。右ペインは空（AC-4/AC-5）
```

### UC-C: 最上位フォルダを右クリックする
```
1. 「ブックマーク バー」を右クリック
2. 「新しいフォルダ」= 有効 / 「名前を変更」「フォルダを削除」= 無効（理由をツールチップ表示）
3. ↑↓ で無効項目にフォーカスは当たるが Enter では何も起きない（既存 ContextMenu の挙動）
```

## エラーハンドリング戦略

新しいエラークラスは作らない（既存方針どおり「ログ + トースト」）。

| 失敗箇所 | 扱い |
|---|---|
| `bookmarkService.rename` | エラートースト（`popupErrorFolderRenameFailed`）。**索引・左ペインには一切触れない** |
| `bookmarkService.create` | エラートースト（`popupErrorFolderCreateFailed`）。左ペインは触れない |
| `reloadIndex`（リネーム後） | ログのみ。リネームは成功しているため操作自体は成功扱い。索引は次回起動で作り直される |
| 空・空白のみの名前 | chrome API を呼ばない。確定ボタンを無効化して**そもそも確定させない**（エラートーストを出す前に防ぐ） |

## テスト戦略

### ユニットテスト（新規）

`pages/popup/src/components/folderMenuModel.test.ts`（新規）:
- `buildFolderMenuItems`: 通常フォルダ（3項目・`delete` のみ danger + 区切り線・無効項目なし）/ 最上位フォルダ（`rename` と `delete` が `disabled`・`create` は有効）/ 並び順の固定
- `validateFolderTitle`: 空文字 / 空白のみ / 前後に空白のある有効名 / 通常名 / 記号や `/` を含む名前（許可されること）
- `planRename`: 変更あり（trim される）/ 変更なし（`unchanged`）/ 前後の空白だけの差（`unchanged`）/ 空名（`invalid`）

`PromptDialog` / `ContextMenu` / `ConfirmDialog` は UI コンポーネントのためユニットテストを書かない（既存の同種コンポーネントと同じ方針。ロジックは純粋モジュール側で固定する）。

### 手動確認（受け入れ時）

- 3項目が並び、削除の上に区切り線があること
- 名前変更 → 左ペイン表示・行のフォルダパス表示・フォルダ名検索の3箇所が追随すること
- 新規作成 → 親が展開され、作ったフォルダがスコープになること
- 最上位フォルダで名前変更/削除が無効・新規作成は有効なこと
- 日本語入力の変換確定 `Enter` でダイアログが閉じないこと
- 空欄では確定ボタンが押せないこと・`Escape` で何も変わらないこと

## 依存ライブラリ

追加なし。

## ディレクトリ構造

```
pages/popup/src/
├── components/
│   ├── folderMenuModel.ts           (新規・純粋)
│   ├── folderMenuModel.test.ts      (新規)
│   ├── PromptDialog.tsx             (新規・汎用)
│   └── （ContextMenu.tsx / FolderTree.tsx / FolderTreeItem.tsx は変更なし）
├── hooks/
│   └── useFolderActions.ts          (拡張: renameFolder / createFolder)
└── Popup.tsx                        (結線: folder-prompt variant・メニュー項目・キー配線3分岐)

packages/i18n/locales/{ja,en}/messages.json  (10キー追加)
docs/functional-design.md                     (UC-5c を追記・操作表を更新)
docs/product-requirements.md                  (機能5 に受け入れ条件を追記)
```

`packages/storage`（データ層）と `packages/shared`（検索）は**変更しない**。

## 実装の順序

1. 純粋モデル（`folderMenuModel`）+ テスト
2. i18n キー追加（ja / en）
3. `useFolderActions` の拡張（`renameFolder` / `createFolder`）
4. UI（`PromptDialog`）
5. `Popup.tsx` 結線（メニュー項目の差し替え → `folder-prompt` の追加 → キー配線）
6. 品質ゲート（test / lint / type-check）
7. 永続ドキュメント更新

## セキュリティ考慮事項

- 追加権限は不要（`bookmarks` 権限の範囲内。`create` / `update` は既存権限で呼べる）。
- 外部通信は増えない（「外部通信ゼロ」方針を維持）。
- フォルダ名はユーザー入力だが、表示は React のテキストノード経由のみで `dangerouslySetInnerHTML` を使わない（既存の行タイトル表示と同じ）。

## パフォーマンス考慮事項

- リネーム時の `reloadIndex` は全ブックマークの索引再構築（起動時と同じコスト・数百 ms 想定）。フォルダ名の変更は低頻度操作のため許容する。ここを部分更新に最適化すると、`SearchEngine` に「フォルダ名の一括差し替え」という新しい索引 API を足すことになり、索引の整合を保つ経路が増える（`folder-delete` のアンドゥで `reloadIndex` を選んだのと同じ判断）。
- 新規作成は索引に触れないため、左ペインの再取得のみで完結する。

## 将来の拡張性

- `PromptDialog` は汎用（文言はすべて呼び出し側）のため、他の1行入力を伴う操作（別名の一括追加など）にも再利用できる。
- `folderMenuModel` は `FolderMenuContext` を持つため、条件付きの項目（「このフォルダを既定の保存先にする」等）を無効条件つきで足せる。
- **申し送り（継続）**: `PANEL` モードの共存フラグは `bulkMovePanel` / `addCurrentPanelOpen` / `contextAction` の3系統のまま（本単位は `contextAction` ユニオンへ variant を足すだけで、既存2つの真偽値には触れていない）。次に PANEL 用途を足すときは、これらを1つの `panelKind` ユニオンへ統合するリファクタを先に行うべき。
- **申し送り（新規）**: フォルダ自体の移動（親の付け替え）は本単位のスコープ外。実装する場合、`MovePanel` の候補から「自分自身とその子孫」を除外する必要がある（現在の候補計算はブックマーク行前提で、その除外を持たない）。
