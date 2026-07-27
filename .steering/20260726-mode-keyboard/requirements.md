# 要求内容 — U8 mode-keyboard（モード状態機械 + 一貫キー操作）

## 概要

Popup に**明示的なモード状態機械**（`LIST` / `INLINE_EDIT` / `ALIAS_EDIT` / `DRAG` / `PANEL`）と、モードごとに一貫したキー割り当て（↑↓ / Enter / Escape）、**Escape の段階的な戻り**、**検索ファースト復帰**（編集モード以外で文字を打つと検索ボックスにフォーカスが戻る）を導入する。これらを再利用可能な `useMode` フックと純粋なモードマシン（`modeMachine.ts`）として実装し、以降の編集・整理系作業単位（U9/U10/U12/U13/U14）がプラグインできる基盤を確立する。（PRD 機能6、[docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) U8、[docs/functional-design.md](../../docs/functional-design.md)「画面遷移図(Popupのモード状態遷移)」）

## 背景

U7 で起動→検索→開く の基本導線（LIST 相当の最小挙動）を Popup のローカル state で暫定実装した（`Popup.tsx` の `selectedIndex` / ↑↓ / Enter）。しかし今後 U9（別名編集）・U10（インライン編集/削除）・U12（フォルダ移動/D&D）・U13（複数選択）を積むと、**同じキー（↑↓/Enter/Escape）がモードによって意味を変える**ため、キー操作の衝突を防ぐ明示的なモード管理が不可欠になる。functional-design「画面遷移図」はこのためのモード状態機械を定義しており、U8 はそれを**実装の中核（`useMode`）として一度だけ用意**し、各モードのキー意味論を単一の場所に集約する。これにより後続単位は「モードに入る/出る」と「自分のモードのインテントに応答する」だけでよくなる。

## 実装対象の機能

### 1. モード状態機械（PRD 機能6 / functional-design 画面遷移図）
- モード種別 `LIST`（既定）/ `INLINE_EDIT` / `ALIAS_EDIT` / `DRAG` / `PANEL` を型として定義する。
- 遷移を純粋なリデューサ（`modeReducer`）として実装する。functional-design の遷移図に忠実に:
  - `LIST → INLINE_EDIT`（編集開始）/ `INLINE_EDIT → LIST`（確定 or 破棄）
  - `LIST → ALIAS_EDIT`（別名編集開始）/ `ALIAS_EDIT → LIST`（編集終了）
  - `LIST → PANEL`（フォルダ選択パネル）/ `PANEL → LIST`（決定 or 閉じる）
  - `LIST → DRAG`（ドラッグ開始）/ `DRAG → LIST`（ドロップ or 中止）
- 各モードは対象行 ID（`targetId`）を保持できる（どの行を編集/操作中かを後続単位へ伝えるため。LIST/DRAG では `null` 可）。

### 2. モードごとの一貫キー割り当て（functional-design「モード別のキー挙動」表）
- 純粋関数 `resolveKeyIntent(mode, key, ctx)` が、モードとキー入力から**インテント**（意味づけされた操作）を返す。全モードの ↑↓ / Enter / Escape を定義通りに解決する:

  | モード | ↑↓ | Enter | Escape |
  |---|---|---|---|
  | LIST（既定） | 選択移動 | 開く | 段階的に戻る（下記） |
  | INLINE_EDIT | キャレット移動（=ネイティブ） | 確定→LIST | 破棄→LIST |
  | ALIAS_EDIT | 候補移動 | チップ確定 | 編集終了→LIST |
  | DRAG | —（無効） | —（無効） | ドラッグ中止→LIST |
  | PANEL | 候補移動 | 決定→LIST | 閉じる→LIST |

- モード入口のショートカット定数を単一箇所（`SHORTCUTS`）に集約する。functional-design 遷移図に準拠: `INLINE_EDIT`=F2 / Ctrl+E、`ALIAS_EDIT`=Ctrl+;、`PANEL`=Ctrl+M。（設計 README の素キー `E`/`A` は検索ファーストと衝突するため非採用。詳細は design.md「キー割り当ての出典と整合」）。

### 3. Escape の段階的な戻り（functional-design LIST 行）
- LIST における Escape は**一度に閉じず、1段階ずつ戻る**。純粋関数 `resolveListEscape(ctx)` が文脈から次の1手を返す:
  1. キーワードあり → **キーワードをクリア**
  2. キーワードなし & フォルダ絞り込みあり → **フォルダ絞り込みを解除**
  3. どちらもなし → **ポップアップを閉じる**
- 非 LIST モードの Escape は当該モードを終了して LIST に戻る（段階戻りは LIST でのみ）。

### 4. 検索ファースト復帰（functional-design「共通ルール」）
- **編集モード（INLINE_EDIT / ALIAS_EDIT）以外**で、フォーカスが検索ボックス外に逸れている状態で**印字可能な文字キー**を打つと、検索ボックスへフォーカスを戻す。
- 印字可能判定 `isPrintableKey(event)` を純粋関数として提供する（修飾キー付き・機能キー・IME 変換中を除外）。

### 5. `useMode` フックと Popup への結線
- `useMode` フックがモード state を保持し、遷移コールバック（`enterInlineEdit(targetId)` / `enterAliasEdit(targetId)` / `enterPanel()` / `enterDrag(targetId)` / `exitToList()`）とキー解決（`resolveKeyIntent` / `resolveListEscape` を現在モード・文脈に束ねたもの）を公開する。
- Popup に結線し、**LIST モードのライブ挙動**（↑↓ 移動 / Enter で開く / 段階的 Escape / 検索ファースト復帰）を `useMode` 経由に置き換える。他モード（INLINE_EDIT/ALIAS_EDIT/DRAG/PANEL）の**UI 実体は後続単位**が実装するため、U8 はモードマシン・キー意味論・遷移 API を提供し、後続単位が呼び出せる形にする。

## 受け入れ条件

> 出典: [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) U8 行（受け入れ基準「各モードで↑↓/Enter/Escapeが定義通り / Escapeが1段階ずつ戻る / 文字入力で検索へ復帰」）＋ [docs/functional-design.md](../../docs/functional-design.md)「画面遷移図(Popupのモード状態遷移)」「モード別のキー挙動」＋ PRD 機能6。

### モード状態機械
- [ ] `LIST` / `INLINE_EDIT` / `ALIAS_EDIT` / `DRAG` / `PANEL` の5モードが型・初期値（`LIST`）付きで定義される。
- [ ] functional-design 遷移図どおりの遷移（LIST↔各モード）が `modeReducer` で成立し、不正遷移は現状維持になる。
- [ ] 各モードは対象行 `targetId` を保持でき、`exitToList()` で `LIST` / `targetId=null` に戻る。

### モードごとのキー割り当て
- [ ] `resolveKeyIntent` が全5モードの ↑↓ / Enter / Escape を上表どおりのインテントへ解決する（ユニットテストで網羅）。
- [ ] DRAG モードでは ↑↓ / Enter が無効（インテントを生まない）で、Escape のみ中止を返す。
- [ ] モード入口ショートカット（F2/Ctrl+E, Ctrl+;, Ctrl+M）が `SHORTCUTS` 定数に集約され、対応する遷移アクションに解決される。

### Escape の段階的な戻り
- [ ] LIST で Escape を押すと「キーワードクリア → フォルダ絞り込み解除 → 閉じる」の順に1段階ずつ戻る（`resolveListEscape` がユニットテストで検証される）。
- [ ] キーワードもフォルダ絞り込みも無い LIST での Escape はポップアップを閉じる（`close` インテント）。
- [ ] 非 LIST モードの Escape は当該モードを終了し LIST に戻る（段階戻りしない）。

### 検索ファースト復帰
- [ ] 編集モード以外で、検索ボックス外にフォーカスがある状態で印字文字を打つと検索ボックスにフォーカスが戻る。
- [ ] `isPrintableKey` が修飾キー付き・機能キー・IME 変換中（`isComposing`）を印字文字と誤判定しない（ユニットテスト）。

### 結線・品質・レイヤー
- [ ] Popup の LIST 挙動（↑↓/Enter/段階Escape/検索ファースト）が `useMode` 経由で成立し、U7 の暫定ローカル実装が置換される。
- [ ] `useMode` は後続単位が使える遷移 API（enter*/exitToList）とキー解決を公開する。
- [ ] `pages/popup` から `chrome.*` を直接呼ばない（LIST の「開く」は従来どおり `bookmarkService.openUrl` 経由）。
- [ ] `pnpm test` / `pnpm lint` / `pnpm type-check` がすべて通る。

## 成功指標

- **キー意味論の単一集約**: 全モードの ↑↓/Enter/Escape の意味が `modeMachine.ts` の純粋関数1箇所に集約され、ユニットテストで全モードが網羅される。
- **後続単位の接続容易性**: U9/U10/U12/U13 は「モードに入る/出る」と「自分のモードのインテントに応答する」だけで実装でき、キー衝突ロジックを再発明しない。
- **回帰なし**: U7 の起動→検索→開く導線・仮想スクロール・フォルダ選択絞り込みが従来どおり動作する。

## スコープ外（後続作業単位）

- INLINE_EDIT の UI 実体（リネーム/URL 編集・確定/破棄・赤枠）→ **U10**
- ALIAS_EDIT の UI 実体（チップ入力・確定/削除・上限表示）→ **U9**
- PANEL の UI 実体（MovePanel・絞り込み→Enter で移動）→ **U12**
- DRAG の UI 実体（5px 開始・ゴースト・スプリングロード・オートスクロール）→ **U12**
- 複数選択モード連携（1f・一括操作バー）→ **U13**
- Ctrl/⌘+Enter の「新規タブで開く」（design README 由来）→ データ層メソッド追加を伴うため U8 では非対応（受け入れ基準外。将来単位で検討）。
- 三角キー（→展開/←折りたたみ）による FolderTree 操作は U7/U11 の FolderTree 側の責務（本単位ではモードマシンに含めない）。

## 参照ドキュメント

- `docs/functional-design.md` - 「画面遷移図(Popupのモード状態遷移)」「モード別のキー挙動」「共通ルール（検索ファースト）」
- `docs/product-requirements.md` - 機能6（モード状態遷移とキーボード操作）
- `docs/mvp-development-flow.md` - U8 受け入れ基準・依存（U7）・状態→作業単位マッピング
- `docs/design/README.md` - インタラクション表（キー操作の視覚仕様。素キー `E`/`A` は非採用の根拠を design.md に記載）
- `docs/architecture.md` - レイヤー依存（UI→サービス→データ）
- `docs/development-guidelines.md` - コーディング規約・命名・テスト戦略
