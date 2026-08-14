# Findmark メンタルモデル

> 2026-08-05 時点（`dev` @ 199fca3 / U10 完了・U11 未着手）のコードを読んで作成。
> ドキュメントではなくコードを正としている。行番号は当時のもの。

## 一行で言うと

**自分がそのページを何と呼んでいるか**（タイトル・フォルダ名・自分で付けた別名）だけを手がかりに、キーボードから手を離さずブックマークへ到達するための Chrome 拡張。

## 処理フロー一覧

各フローに2枚の図がある。**A = 処理の流れ**（誰が誰を呼び、どこで失敗するか）、**B = 依存グラフ**（何に依存し、変えると何に波及するか）。

| # | フロー | 起動される条件 | 何をするか | 起点 |
|---|---|---|---|---|
| 1 | 索引を構築する | ポップアップを開くたび | ブックマーク全件＋別名を平坦な `SearchEntry[]` に変換してメモリに置く | `useSearch.ts:42` |
| 2 | 検索して目的のブックマークを開く | 検索ボックスへの入力 → Enter | 索引を同期走査して結果を並べ、現在タブで開く | `SearchHeader.tsx:35` |
| 3 | キー入力を解釈してモードとフォーカスを動かす | `document` の keydown すべて | キーを1つの意図に変換し、モードとフォーカス位置を決める | `Popup.tsx:221` |
| 4 | フォルダを選んで検索範囲を絞る | 左ペインのフォルダ選択チップのクリック | スコープを1つ設定し、その**直下のみ**を対象にする | `FolderTreeItem.tsx:109` |
| 5 | 別名を追加して保存する | 別名チップ領域のクリック / 別名編集キー | 正規化重複と上限を弾き、`chrome.storage` へ保存して索引に反映 | `AliasEditor.tsx:150` |
| 6 | 行をインライン編集して保存する | `F2` / `Ctrl+E` / 行のダブルクリック | タイトルと URL をその場で書き換え、成功したものだけ索引に反映 | `InlineEdit.tsx:35` |
| 7 | 行を削除して5秒以内に元に戻す | `Delete` / ゴミ箱アイコン | 削除して復元情報を退避し、5秒間だけアンドゥを保持 | `useRowActions.ts:69` |

描いていないもの: options ページ / devtools パネル / content-runtime（いずれもボイラープレートのテーマ切替デモのまま）、background service worker（9行のログ出力のみ。U17 未着手）。必要なら追加で描ける。

---

## 全体図

**処理**: このプロダクトが持つ処理フロー全体の配置
**起動**: —（個別の処理ではなく、全体の見取り図）
**範囲**: 起点となる入口、主要7フロー、それらが共有する中核とデータ層の境界
**含まない**: 各フローの内部（→ 以下の A・B の図）

```mermaid
---
title: "全体図: Findmark の処理フローと共有される中核の配置"
---
flowchart LR
  subgraph ENTRY[起点]
    ICON["拡張アイコン / Ctrl+Shift+F<br/>manifest.ts:39-54"]
    OPS["Popup 上の操作<br/>キー入力・クリック"]
  end

  subgraph GATE[入力の解釈]
    F3(["3 モードとフォーカス"])
  end

  subgraph FLOWS[処理フロー]
    F1(["1 索引を構築する"])
    F2(["2 検索して開く"])
    F4(["4 スコープを絞る"])
    F56(["5・6 別名/インライン編集"])
    F7(["7 削除とアンドゥ"])
  end

  subgraph CORE["共有される中核 services.ts:12-14"]
    IDX[("searchEngine<br/>SearchEntry 索引")]
    UNDO[("undoManager<br/>直近1件・5秒")]
    NZ(["normalizer 純粋"])
  end

  subgraph DATA[データ層]
    BS["BookmarkService"]
    AS["AliasStore"]
  end

  EXT{{"chrome.bookmarks / tabs / storage"}}

  ICON --> F1
  OPS --> F3
  F3 --> F2 & F4 & F56 & F7
  F1 -->|"BookmarkNode と AliasRecord から構築"| IDX
  F2 -->|"SearchQuery で読む"| IDX
  F4 -->|"folderId で範囲を絞る"| IDX
  F56 -->|"updateAliases / updateNode"| IDX
  F7 -->|"removeNode / addNode"| IDX
  F7 -->|"register で預ける"| UNDO
  F1 --> BS & AS
  F56 --> BS & AS
  F7 --> BS & AS
  BS --> EXT
  AS --> EXT
  BS -.->|"注入される"| NZ
  AS -.->|"注入される"| NZ
  IDX -.->|"注入される"| NZ

  style IDX stroke-width:3px
```

**図の読み方**（以降のすべての図で共通）

| 記法 | 意味 |
|---|---|
| `([ 角丸 ])` | 純粋モジュール（React・chrome・DOM に非依存で単体テスト可能） |
| `[( 円筒 )]` | 状態を持つ単一実体（モジュールスコープ or React state） |
| `{{ 六角 }}` | chrome の外部 API（自分たちの管轄外） |
| 破線の矢印 | 他フローからの依存・書き込み |
| 太枠 | 複数フローが共有する変更の波及点 |

読み取るべきは1点。**`searchEngine` の索引に矢印が集中している**こと。フロー1が作り、フロー2が読み、フロー4〜7が書き換えます。再構築は一切走らないので、**索引を書き換え忘れた差分は「画面と実データがずれる」形で必ず表面化します**。

### 中核概念

- **索引（`SearchEntry[]`）** — 起動時に1回だけ構築される平坦な配列。ここでブックマークの木構造が消え、正規化済みのタイトル/フォルダ名/別名が事前計算される `packages/shared/lib/search/SearchEngine.ts:29,61`
- **`Normalizer`** — 文字列比較の唯一の入り口。NFKC → 小文字化 → カタカナ→ひらがな。順序に意味がある `packages/shared/lib/search/Normalizer.ts:20`
- **`urlHash`** — 別名とブックマークを結ぶキー。Chrome の `node.id` **ではなく**正規化 URL の FNV-1a ハッシュ `packages/storage/lib/types.ts:43`
- **`Mode` / `ListFocus`** — キー意味論を決める状態。`Mode` は6種、`ListFocus` は LIST 内の検索ボックス/右ペインの別。統合位置 `FocusArea` は独立 state に持たず必ず導出する `pages/popup/src/hooks/modeMachine.ts:23,29,38`
- **`KeyIntent` / `ShortcutIntent`** — 「このキーは何をしたいのか」だけを表す値。純粋関数が変換し、`Popup.tsx` は実行のみ `modeMachine.ts:86,144,284`
- **`SearchResultItem`** — 検索層から UI へ渡る唯一の型。ノード＋フォルダパス＋別名＋**マッチ理由**を運ぶ `packages/shared/lib/types/search.ts:22`
- **`CommitPlan` / `CommitOutcome`** — 編集の確定判定を表す判別可能ユニオン。「何を保存すべきか」を純粋関数が決め、React 層は実行するだけ `inlineEditModel.ts:50` / `aliasEditorModel.ts:27`

---

## フロー1: 索引を構築する

**処理**: ブックマーク全件と別名を読み込み、検索用の索引をメモリに構築する
**起動**: ポップアップが開かれ `Popup` がマウントされたとき（依存配列 `[]` の effect）
**範囲**: `useSearch` の mount から `isIndexReady = true` まで
**含まない**: 構築後の索引の部分更新（→ フロー5・6・7）、検索の実行（→ フロー2）

### 1-A 処理の流れ
> 答える問い: 誰が誰を呼び、何が返り、どこで失敗するか

```mermaid
---
title: "フロー1-A: 索引を構築する — 処理の流れ"
---
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant C as Chrome
    participant S as useSearch<br/>pages/popup/src/hooks
    participant E as searchEngine<br/>packages/shared/lib/search
    participant B as BookmarkService<br/>packages/storage
    participant A as AliasStore<br/>packages/storage

    U->>C: アイコン click / Ctrl+Shift+F
    C->>S: popup/index.html → Popup mount
    S->>E: loadIndex(bookmarkService, aliasStore)
    par Promise.all
        E->>B: getTree()
        B-->>E: BookmarkNode[] （chrome の木を toDomain で写像）
    and
        E->>A: getAll()
        A-->>E: Map urlHash → AliasRecord （全チャンク結合）
    end
    alt 両方成功
        E->>E: buildIndex — 木を平坦化し正規化を事前計算
        E-->>S: this.entries に代入
    else どちらかが reject
        E-->>S: reject（entries は空のまま）
        S->>S: console.error のみ
    end
    S->>S: finally で setIsIndexReady(true)
    Note over S: 失敗しても true になる。<br/>画面上は「0件」と区別がつかない
```

### 1-B 依存グラフ
> 答える問い: このフローは何に依存し、変更すると何に波及するか

```mermaid
---
title: "フロー1-B: 索引を構築する — 依存グラフ"
---
flowchart LR
  subgraph OWN["このフロー専用"]
    US["useSearch の mount effect<br/>hooks/useSearch.ts:42-57"]
  end

  subgraph SHARED["他フローと共有 = 変更の波及点"]
    SE[("searchEngine 単一実体<br/>services.ts:12")]
    NZ(["normalizer 純粋<br/>shared/lib/search/Normalizer.ts"])
    BS["BookmarkService<br/>storage/lib/impl/bookmarkService.ts"]
    AS["AliasStore<br/>storage/lib/impl/aliasStore.ts"]
  end

  EXT{{"chrome.bookmarks / chrome.storage"}}
  OTHER["フロー2・4〜7"]

  US -->|"loadIndex を1回だけ呼ぶ"| SE
  SE -->|"getTree で木を得る"| BS
  SE -->|"getAll で別名を得る"| AS
  SE -->|"normalizeText を事前計算に使う"| NZ
  AS -->|"hashUrl で紐付けキーを作る"| NZ
  BS --> EXT
  AS --> EXT
  OTHER -.->|"同じ索引を読み書きする"| SE

  style SE stroke-width:3px
```

**要点**

- **開くたびに毎回フルロードが走る。** popup は閉じるとプロセスごと消えるので「起動時1回」＝「開くたび1回」。起動 200ms 要件を食う唯一の非同期処理はここ
- **失敗が観測できない。** `catch` はログのみ、`finally` で必ず `isIndexReady = true` (`useSearch.ts:46-53`)
- **`normalizer` は3方向から注入されている。** B の3本の破線がそれ。`packages/storage` は `packages/shared` に依存できない（循環になる）ため、実体は `services.ts` が注入し、`AliasStore` / `SearchEngine` は構造的インターフェースでしか受けない (`aliasStore.ts:33` / `SearchEngine.ts:14`)。**`Normalizer` のシグネチャを変えると、この2つのインターフェース定義も直す必要がある**
- **不変条件（コード強制）**: `buildIndex` は `url` を持つノードだけを entry にし、真のルートはフォルダパスに積まない (`SearchEngine.ts:80,96`)。この規則は `BookmarkService.getFolderPath` と一致していなければならない — ずれると削除アンドゥの復元先が変わる
- **罠**: `loadIndex` を呼ぶ本番コードはここ1箇所だけ。再構築の手段が存在しないので、「データが変わったから作り直す」という発想のコードは設計から外れる

---

## フロー2: 検索して目的のブックマークを開く

**処理**: 入力されたキーワードで索引を検索し、選ばれた行を現在タブで開く
**起動**: 検索ボックスへの入力、その後の Enter または行クリック
**範囲**: `onChange` の発火から `chrome.tabs.update` まで
**含まない**: 索引の構築（→ フロー1）、フォルダスコープの設定（→ フロー4）、キーの解決過程（→ フロー3）

### 2-A 処理の流れ
> 答える問い: 誰が誰を呼び、何が返り、どこで失敗するか

```mermaid
---
title: "フロー2-A: 検索して目的のブックマークを開く — 処理の流れ"
---
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant H as SearchHeader
    participant S as useSearch
    participant E as searchEngine
    participant L as ResultList
    participant B as BookmarkService

    U->>H: "git" と入力
    H->>S: query = "git"
    Note over S: 120ms debounce。連打時は<br/>最後の1回だけが通る
    S->>E: search(keywords=["git"], folderScope)
    Note over E: キーワードを normalizeText で同値化。<br/>"ＧIT" も "ぎっと" もここで一致する
    alt keywords が空
        E-->>S: スコープ内全件をタイトル昇順（ブラウズ）
    else AND 部分一致あり
        Note over E: 基礎点 タイトル10 / 別名8 / フォルダ4<br/>+ 完全一致5 / 前方一致3
        E-->>S: SearchResultItem[] （score 降順・同点はタイトル昇順）
    else 0 件
        E->>E: fuzzyFallback（編集距離が 4文字以下なら1、以上なら2 以内）
        E-->>S: SearchResultItem[] （score は距離の符号反転＝負数）
    end
    S->>L: results と selectedIndex
    L-->>U: 可視範囲のみ描画（行高 56px 固定の自前仮想スクロール）
    U->>B: Enter または行クリック → openUrl(url)
    B-->>U: chrome.tabs.update で現在タブが遷移
```

### 2-B 依存グラフ
> 答える問い: このフローは何に依存し、変更すると何に波及するか

```mermaid
---
title: "フロー2-B: 検索して目的のブックマークを開く — 依存グラフ"
---
flowchart LR
  subgraph OWN["このフロー専用"]
    SH["SearchHeader<br/>components/SearchHeader.tsx"]
    RL["ResultList<br/>components/ResultList.tsx"]
    RR["ResultRow<br/>components/ResultRow.tsx"]
    VZ(["computeWindow 純粋<br/>components/virtualization.ts"])
  end

  subgraph SHARED["他フローと共有 = 変更の波及点"]
    POP["Popup.tsx"]
    US["useSearch<br/>hooks/useSearch.ts"]
    SE[("searchEngine 索引")]
    NZ(["normalizer 純粋"])
    BS["BookmarkService"]
  end

  EXT{{"chrome.tabs.update"}}
  OTHER["フロー1・4〜7"]

  POP -->|"query と onQueryChange を渡す"| SH
  POP -->|"results と isIndexReady を得る"| US
  POP -->|"results と selectedIndex を渡す"| RL
  POP -->|"openUrl で現在タブを遷移させる"| BS
  RL -->|"可視範囲を計算する"| VZ
  RL -->|"行を描画し click を通知"| RR
  US -->|"search で同期走査する"| SE
  SE -->|"normalizeText で同値化する"| NZ
  BS --> EXT
  OTHER -.->|"索引を作る / 書き換えて refresh を呼ぶ"| US

  style SE stroke-width:3px
  style US stroke-width:3px
```

**要点**

- **不変条件（コード強制）**: `search()` は同期関数。1,000件で1文字あたり100msという要件のため、索引構築だけを非同期の外縁にしている (`SearchEngine.ts:55-58`)。`async` 化する差分は要件違反
- **あいまい一致は0件のときだけ。** しかも AND 条件は維持される (`SearchEngine.ts:126,341`)。スコアが負数なのは通常検索と同じ降順ソートに乗せるため — 符号で分岐するコードを足すと壊れる
- **依存グラフに線としては描けない波及**: `results` が再計算される条件は `debouncedQuery` / `isIndexReady` / `folderId` の3つだけ (`useSearch.ts:73`)。**索引の中身の変化はこの依存に入っていない**ので、書き換えたフローは自分で `refresh()` を呼ばないと画面が古いままになる。B の破線が「refresh を呼ぶ」で終わっているのはそのため
- **罠**: 行の**シングルクリックは「開く」**が既定 (`ResultRow.tsx:136`)。編集アイコン・削除アイコン・別名チップ領域だけが `data-*` 属性で分岐している (`ResultRow.tsx:122-137`)

---

## フロー3: キー入力を解釈してモードとフォーカスを動かす

**処理**: `document` に届いたキーを1つの意図に変換し、モードとフォーカス位置を決める
**起動**: ポップアップ内のあらゆる keydown
**範囲**: `document` のリスナー入口から、いずれかの操作の実行または無視まで
**含まない**: 実行される操作の中身（→ フロー5・6・7）、編集フォーム内部のキー処理（各コンポーネントが `stopPropagation` して処理する）

### 3-A 処理の流れ
> 答える問い: 誰が誰を呼び、何が返り、どこで失敗するか

```mermaid
---
title: "フロー3-A: キー入力を解釈してモードとフォーカスを動かす — 処理の流れ"
---
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant P as Popup の document keydown
    participant MM as modeMachine<br/>純粋関数
    participant M as useMode<br/>useReducer
    participant IN as 検索ボックス input

    U->>P: keydown
    alt e.isComposing
        P-->>U: 何もしない（IME 確定を操作にしない）
    else Ctrl/Cmd+Z かつ アンドゥ保持あり かつ 編集モードでない
        P->>MM: resolveShortcutIntent(e)
        MM-->>P: undo
        P->>P: undoLatest を実行（→ フロー7）
    else 現在モードが LIST
        P->>MM: resolveShortcutIntent(e)
        alt inline-edit / alias-edit / delete
            MM-->>P: ShortcutIntent
            P->>M: exitToList してから enterInlineEdit / enterAliasEdit
            Note over P,M: delete はモード遷移を伴わず、<br/>listFocus が result のときだけ有効
        else null
            P->>M: resolveKey(e, listFocus)
            M->>MM: resolveKeyIntent(mode, e, listFocus)
            MM-->>M: KeyIntent
            M-->>P: KeyIntent
            P->>P: selectedIndex 更新 / 開く / 左ペインへ / Escape 段階戻り
        end
    else 現在モードが FOLDER_TREE
        P->>M: resolveKey(e, listFocus)
        M-->>P: 右ペインへの移動と Escape だけ実行される
        Note over P: 上下・親フォルダ・展開トグルは<br/>インテントを受けても握り潰す（U11 未結線）
    end
    opt 印字文字 or Backspace かつ 入力欄の外 かつ 編集モードでない
        P->>IN: focus()
        Note over IN: 打った文字はブラウザの既定動作で<br/>そのまま input に入る
    end
```

### 3-B 依存グラフ
> 答える問い: このフローは何に依存し、変更すると何に波及するか

```mermaid
---
title: "フロー3-B: キー入力を解釈してモードとフォーカスを動かす — 依存グラフ"
---
flowchart LR
  subgraph OWN["このフロー専用"]
    KD["Popup の document keydown<br/>Popup.tsx:220-341"]
    UMH["useMode<br/>hooks/useMode.ts"]
  end

  subgraph SHARED["他フローと共有 = 変更の波及点"]
    MM(["modeMachine 純粋<br/>hooks/modeMachine.ts"])
    ST[("Popup の state<br/>listFocus / selectedIndex / mode")]
    UD[("undoManager<br/>services.ts:14")]
  end

  subgraph EXC["規律の例外"]
    AE["AliasEditor は modeMachine を使わず<br/>e.key を直接判定する<br/>AliasEditor.tsx:150-186"]
  end

  IE["InlineEdit フロー6"]

  KD -->|"resolveShortcutIntent で入口キーを判定"| MM
  KD -->|"isSearchFirstTriggerKey で復帰を判定"| MM
  KD -->|"resolveKey で KeyIntent を得る"| UMH
  KD -->|"listFocus と selectedIndex を書き換える"| ST
  KD -->|"undoLatest を条件付きで奪う"| UD
  UMH -->|"resolveKeyIntent を現在モードに束ねる"| MM
  UMH -->|"modeReducer で遷移する"| MM
  IE -.->|"resolveKeyIntent INLINE_EDIT を直接呼ぶ"| MM

  style MM stroke-width:3px
```

**要点**

- **不変条件（コード強制）**: モードへの入口は `LIST` からのみ有効。`modeReducer` が `LIST` 以外の `ENTER_*` を現状維持に倒す (`modeMachine.ts:62-79`)。だから別の行の編集に切り替えるには一度 `exitToList()` する (`Popup.tsx:116-117`)
- **`Ctrl/Cmd+Z` の乗っ取りは条件付き。** アンドゥ保持があり、かつ `INLINE_EDIT`/`ALIAS_EDIT`/`PANEL` でないときだけ。編集中のテキスト取り消しのつもりの Ctrl+Z が無関係な削除を復元する事故を避けるため (`Popup.tsx:229-239`)
- **`Delete` だけがフォーカス位置を見る。** `listFocus === 'result'` のときのみ削除になる (`Popup.tsx:255`)。逆に `F2`/`Ctrl+E` はフォーカス位置を見ないので、**検索ボックスに居ても編集に入れる**
- **B の「規律の例外」が示すもの**: `InlineEdit` は `resolveKeyIntent('INLINE_EDIT', e)` を経由するが、**`AliasEditor` は経由せず自前で `e.key` を判定している**。結果として `modeMachine` の `alias:confirm` / `alias:exit` / `alias:candidate-*` は定義とテストだけが存在し、本番コードに消費者がいない（grep 済み）。「キー割り当ての single source of truth」という設計意図はここで破れている
- **編集モードのキーは document まで来ない。** 両コンポーネントとも自分が処理するキーを `stopPropagation()` する (`InlineEdit.tsx:51` / `AliasEditor.tsx:160`)。これがないと「閉じる Enter」がそのまま「開く」に化ける

---

## フロー4: フォルダを選んで検索範囲を絞る

**処理**: 左ペインでフォルダを1つ選び、検索対象をその範囲に限定する
**起動**: 左ペインのフォルダ選択チップのクリック（「すべて」を含む）
**範囲**: チップの click から、絞り込まれた `results` の再計算まで
**含まない**: キーボードでのフォルダ移動とスコープ追従（U11 未実装）、展開状態の永続化（U11）

### 4-A 処理の流れ
> 答える問い: 誰が誰を呼び、何が返り、どこで失敗するか

```mermaid
---
title: "フロー4-A: フォルダを選んで検索範囲を絞る — 処理の流れ"
---
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant FT as FolderTree
    participant B as BookmarkService
    participant FM as folderTreeModel<br/>純粋関数
    participant P as Popup
    participant S as useSearch
    participant E as searchEngine

    Note over FT,B: マウント時（フロー1とは別に木を取得する）
    FT->>B: getTree()
    alt 成功
        B-->>FT: BookmarkNode[]
        FT->>FM: buildFolderTree — フォルダのみに写像し配下件数を数える
        FM-->>FT: FolderTreeNode[]
    else reject
        B-->>FT: error
        FT->>FT: console.error のみ。左ペインは空のまま
    end

    U->>FT: フォルダ選択チップを click
    FT->>P: onSelectFolder（同じフォルダの再クリックで null に戻る）
    P->>P: selectedFolderId を更新し selectedIndex を 0 に戻す
    P->>S: folderId 引数として渡る
    alt folderId が null
        S->>E: folderScope 未指定で search
        E-->>S: 全ブックマークが対象
    else folderId あり
        S->>E: folderScope 付きで search
        Note over E: inScope は parentId の一致だけを見る<br/>= そのフォルダの直下のみ
        E-->>S: 直下のブックマークのみ
    end
```

### 4-B 依存グラフ
> 答える問い: このフローは何に依存し、変更すると何に波及するか

```mermaid
---
title: "フロー4-B: フォルダを選んで検索範囲を絞る — 依存グラフ"
---
flowchart LR
  subgraph OWN["このフロー専用"]
    FT["FolderTree<br/>components/FolderTree.tsx"]
    FTI["FolderTreeItem<br/>components/FolderTreeItem.tsx"]
    FM(["folderTreeModel 純粋<br/>buildFolderTree / countDescendants"])
  end

  subgraph SHARED["他フローと共有 = 変更の波及点"]
    ST[("Popup の state<br/>selectedFolderId")]
    US["useSearch"]
    SE[("searchEngine 索引")]
    BS["BookmarkService"]
  end

  EXT{{"chrome.bookmarks.getTree"}}
  F1["フロー1 索引構築"]
  F567["フロー5〜7 編集・削除"]

  ST -->|"selectedFolderId と onSelectFolder を渡す"| FT
  FT -->|"同じ props を子へ渡す"| FTI
  FT -->|"getTree で木を独立に取得する"| BS
  FT -->|"フォルダのみのツリーへ写像する"| FM
  ST -->|"folderId 引数として渡る"| US
  US -->|"folderScope 付きで search する"| SE
  BS --> EXT
  F1 -.->|"同じ getTree を別に呼ぶ（二重読み）"| BS
  F567 -.->|"索引だけを書き換える（左ペインは追従しない）"| SE

  style SE stroke-width:3px
```

**要点**

- **「直下のみ」であってツリー配下ではない。** U6a の仕様変更で `includeSubfolders` が型・実装・テストから消えた。判定は `parentId` の一致1行だけ (`SearchEngine.ts:222-227`)
- **フォルダ名は照合対象としては生きている。** スコープは範囲フィルタだが、フォルダ名は検索キーワードのマッチ対象（基礎点4）でもある。この2つは別物 (`SearchEngine.ts:240`)
- **B の2本の破線が同じ問題の表と裏**: フロー1と `FolderTree` が `getTree()` を独立に呼び、結果を別々に保持する。そのため削除やアンドゥで索引が変わっても**左ペインの件数は更新されない**。左ペインを触る差分（U11）は、この二重読みを統合するかどうかを最初に決める必要がある
- **スコープは ID で保持する。** フォルダ名に `/` が含まれていても壊れないようにするため (`types/search.ts:44-47`)

---

## フロー5: 別名を追加して保存する

**処理**: 結果行に別名チップを追加し、`chrome.storage` へ保存して検索索引へ反映する
**起動**: 別名チップ領域のクリック、または別名編集キー
**範囲**: 入力欄での確定キーから、永続化と再検索の完了まで
**含まない**: 別名の検索時の使われ方（→ フロー2）、タイトル/URL の編集（→ フロー6）

### 5-A 処理の流れ
> 答える問い: 誰が誰を呼び、何が返り、どこで失敗するか

```mermaid
---
title: "フロー5-A: 別名を追加して保存する — 処理の流れ"
---
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant AE as AliasEditor
    participant AM as aliasEditorModel<br/>純粋関数
    participant P as Popup commitAliases
    participant AS as AliasStore
    participant S as useSearch
    participant E as searchEngine

    U->>AE: "ぎっとはぶ" と入力して Enter
    AE->>AM: commitAlias(chips, input, normalizeText)
    alt added
        AM-->>AE: 追加後の配列
        AE->>AE: setChips(next) — 先に画面を更新（楽観更新）
        AE->>P: onCommit(next)
        P->>AS: upsert(url, aliases)
        Note over AS: writeQueue で直列化 → hashUrl でチャンクを選び<br/>read-modify-write → sync が容量超過なら local へ退避
        alt 保存成功
            AS-->>P: 完了
            P->>S: updateAliases(url, aliases)
            S->>E: hashUrl が一致する全エントリの別名を差し替える
            S->>S: refresh で再検索
        else reject
            AS-->>AE: error
            AE->>AE: setChips(prev) でロールバック
        end
    else duplicate
        AM-->>AE: 既存チップの index
        AE-->>U: そのチップを 450ms 光らせる（保存しない）
    else too-long / at-limit
        AM-->>AE: 上限超過
        AE-->>U: 上限表示をフラッシュ（入力は消さない）
    end
```

### 5-B 依存グラフ
> 答える問い: このフローは何に依存し、変更すると何に波及するか

```mermaid
---
title: "フロー5-B: 別名を追加して保存する — 依存グラフ"
---
flowchart LR
  subgraph OWN["このフロー専用"]
    AE["AliasEditor<br/>components/AliasEditor.tsx"]
    AM(["aliasEditorModel 純粋<br/>commitAlias / removeAt / orderMatchedFirst"])
  end

  subgraph SHARED["他フローと共有 = 変更の波及点"]
    CB["Popup commitAliases<br/>Popup.tsx:128-138"]
    AS["AliasStore<br/>storage/lib/impl/aliasStore.ts"]
    NZ(["normalizer 純粋"])
    US["useSearch updateAliases"]
    SE[("searchEngine 索引")]
  end

  EXT{{"chrome.storage.sync → local"}}
  F6["フロー6 URL 編集"]

  AE -->|"commitAlias で確定判定を委ねる"| AM
  AE -->|"normalizeText で重複を判定する"| NZ
  AM -->|"上限 20個/50文字 を import する"| AS
  AE -->|"onCommit で永続化を依頼する"| CB
  CB -->|"upsert で保存する"| AS
  CB -->|"索引へ反映する"| US
  US -->|"updateAliases で差し替える"| SE
  AS -->|"hashUrl で紐付けキーを作る"| NZ
  AS --> EXT
  F6 -.->|"URL 変更時に旧レコードを remove する"| AS

  style AS stroke-width:3px
```

**要点**

- **不変条件（コード強制）**: 永続化 → 索引反映の順序。`commitAliases` は `await aliasStore.upsert()` の後でしか `updateAliases()` を呼ばない (`Popup.tsx:134-135`)。逆順にすると保存に失敗しても画面だけ更新される
- **不変条件（コード強制）**: `upsert`/`remove` の read-modify-write は `writeQueue` で直列化される (`aliasStore.ts:69,168`)。並行実行すると後勝ちの `set` が先の変更を丸ごと消す（コメントに実測で確認済みと明記）。キューを迂回する書き込み経路を足したら壊れる
- **B の `aliasEditorModel → AliasStore` の矢印に注意。** UI の純粋モジュールがデータ層から**定数だけ**を import している (`aliasEditorModel.ts:14`)。上限値を UI 側で再定義しないためのドリフト防止策で、逆向きの依存ではない
- **チップのクリックは保存しない。** 再編集のため入力欄へ戻すだけ。誤クリック後に Escape で離脱しても別名が失われないようにするため（別名削除にアンドゥが無い）(`AliasEditor.tsx:138-148`)
- **影響範囲**: `updateAliases` は `hashUrl` 一致の**全エントリ**に適用される (`SearchEngine.ts:145-160`)。同じ URL のブックマークが複数あれば全部に反映される

---

## フロー6: 行をインライン編集して保存する

**処理**: 結果行のタイトルと URL をその場で書き換えて保存する
**起動**: `F2` / `Ctrl+E` / 行のダブルクリック
**範囲**: 編集フォームの表示から、保存完了して LIST に戻るまで
**含まない**: 別名の編集（→ フロー5）、削除（→ フロー7）

### 6-A 処理の流れ
> 答える問い: 誰が誰を呼び、何が返り、どこで失敗するか

```mermaid
---
title: "フロー6-A: 行をインライン編集して保存する — 処理の流れ"
---
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant IE as InlineEdit
    participant IM as inlineEditModel<br/>純粋関数
    participant RA as useRowActions
    participant B as BookmarkService
    participant AS as AliasStore
    participant E as searchEngine

    U->>IE: タイトル / URL を書き換えて Enter
    IE->>IM: planCommit(original, draft)
    alt invalid
        IM-->>IE: CommitPlan invalid
        IE-->>U: 赤枠とメッセージ。onCommit を呼ばず編集に留まる
    else unchanged
        IM-->>IE: CommitPlan unchanged
        IE->>RA: 何も呼ばず LIST へ戻る
    else update
        IM-->>IE: CommitPlan update（変化したフィールドのみ）
        IE->>RA: commitEdit(item, plan)
        opt title に差分あり
            RA->>B: rename(id, title)
            RA->>E: updateNode で索引のタイトルを更新
        end
        opt url に差分あり
            RA->>B: updateUrl(id, url)
            RA->>E: updateNode で索引の URL を更新し別名を空にする
            RA->>AS: remove(旧 URL) — 孤児レコードを消す
        end
        alt すべて成功
            RA->>RA: refresh で再検索
        else どこかで reject
            RA-->>U: 索引を触らず danger トースト
            Note over RA: 成功した分だけが既に索引に反映されている
        end
    end
```

### 6-B 依存グラフ
> 答える問い: このフローは何に依存し、変更すると何に波及するか

```mermaid
---
title: "フロー6-B: 行をインライン編集して保存する — 依存グラフ"
---
flowchart LR
  subgraph OWN["このフロー専用"]
    IE["InlineEdit<br/>components/InlineEdit.tsx"]
    IM(["inlineEditModel 純粋<br/>validateUrl / planCommit"])
  end

  subgraph SHARED["他フローと共有 = 変更の波及点"]
    MM(["modeMachine 純粋"])
    RA["useRowActions<br/>hooks/useRowActions.ts"]
    BS["BookmarkService"]
    AS["AliasStore"]
    SE[("searchEngine 索引")]
    US["useSearch refresh"]
  end

  EXT{{"chrome.bookmarks.update"}}
  F7["フロー7 削除"]

  IE -->|"planCommit で確定計画を決める"| IM
  IE -->|"resolveKeyIntent INLINE_EDIT で Enter/Escape を解釈"| MM
  IE -->|"CommitPlan を渡す"| RA
  RA -->|"rename と updateUrl を呼ぶ"| BS
  RA -->|"旧 URL の別名レコードを remove する"| AS
  RA -->|"updateNode で索引を部分更新する"| SE
  RA -->|"refresh で再検索させる"| US
  BS --> EXT
  F7 -.->|"同じ useRowActions を共有する"| RA

  style RA stroke-width:3px
  style SE stroke-width:3px
```

**要点**

- **不変条件（コード強制）**: タイトルと URL は**別々に** await して、それぞれ成功した直後に索引へ反映する (`useRowActions.ts:41-50`)。1つの try にまとめて索引更新を最後に1回にすると、片方だけ失敗したときに「実データは変更済み・索引は旧値」の乖離が生まれる
- **URL を変えると別名は引き継がれない。** 別名は `urlHash` で紐づくので URL が変われば別レコードになる。旧レコードは明示的に削除する — 同じ URL が将来別のブックマークとして登録されたときに別名が"復活"するのを防ぐため (`useRowActions.ts:51-58` / `SearchEngine.ts:179-183`)
- **`javascript:` と `data:` は保存できない。** それ以外は `chrome://` も含めて許可（既存ブックマークが持ち得るため）(`inlineEditModel.ts:14,32`)
- **フォーカスアウトは確定であって破棄ではない。** ただしフォーム内の Tab 移動では確定しない（`relatedTarget` がフォーム内かを見る）(`InlineEdit.tsx:70-76`)
- **罠**: URL が不正なままフォーカスアウトすると `planCommit` が `invalid` を返し `onCommit` が呼ばれない＝**編集モードから抜けられない** (`InlineEdit.tsx:35-42`)

---

## フロー7: 行を削除して5秒以内に元に戻す

**処理**: ブックマークを削除し、5秒間だけ取り消せる状態を保持する
**起動**: 右ペインにフォーカスがある状態での `Delete`、またはゴミ箱アイコンのクリック
**範囲**: 削除の実行から、アンドゥの成功または5秒経過による確定まで
**含まない**: 30日ゴミ箱による第2層の防御（U16 未実装）、`Ctrl+Z` がアンドゥとして解釈される条件（→ フロー3）

### 7-A 処理の流れ
> 答える問い: 誰が誰を呼び、何が返り、どこで失敗するか

```mermaid
---
title: "フロー7-A: 行を削除して5秒以内に元に戻す — 処理の流れ"
---
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant RA as useRowActions
    participant B as BookmarkService
    participant AS as AliasStore
    participant E as searchEngine
    participant UM as undoManager

    U->>RA: Delete キー / ゴミ箱アイコン click
    Note over RA: 復元用に folderPath と aliases を<br/>索引から先に退避する
    RA->>B: remove(id)
    alt remove が reject
        B-->>RA: error
        RA-->>U: 「削除できませんでした」— 索引は無傷
    else 成功
        RA->>AS: remove(url)
        Note over AS: 失敗してもログのみで続行。<br/>アンドゥ時の upsert で整合する
        RA->>E: removeNode(id)
        RA->>RA: refresh — 行が消える
        RA->>UM: register(label, undo, 期限は5秒後)
        UM-->>U: トースト「元に戻す」
        alt 5秒以内に Ctrl+Z またはトーストの click
            UM->>RA: undo()
            RA->>B: ensureFolderPath → create（新しい id が採番される）
            RA->>AS: upsert(url, aliases)
            RA->>E: addNode(created, folderPath, aliases)
            RA->>RA: refresh — 行が戻る
        else 5秒経過 / トーストを閉じる
            UM->>UM: 保持を破棄（以後アンドゥ不可）
        end
    end
```

### 7-B 依存グラフ
> 答える問い: このフローは何に依存し、変更すると何に波及するか

```mermaid
---
title: "フロー7-B: 行を削除して5秒以内に元に戻す — 依存グラフ"
---
flowchart LR
  subgraph OWN["このフロー専用"]
    TO["Toast<br/>components/Toast.tsx"]
    UU["useUndo<br/>hooks/useUndo.ts"]
  end

  subgraph SHARED["他フローと共有 = 変更の波及点"]
    POP["Popup.tsx"]
    RA["useRowActions"]
    UD[("undoManager<br/>UndoManager の単一実体 services.ts:14")]
    BS["BookmarkService"]
    AS["AliasStore"]
    SE[("searchEngine 索引")]
  end

  EXT{{"chrome.bookmarks.remove / create"}}
  KD["フロー3 keydown"]
  F6["フロー6 編集"]

  POP -->|"pending を props で渡す"| TO
  POP -->|"pending を購読し register を配る"| UU
  UU -->|"subscribe で保持状態を受け取る"| UD
  RA -->|"register でアンドゥ手続きを預ける"| UD
  RA -->|"remove と create を呼ぶ"| BS
  RA -->|"remove と upsert を呼ぶ"| AS
  RA -->|"removeNode / addNode で索引を更新する"| SE
  BS --> EXT
  KD -.->|"Ctrl+Z で undoLatest を呼ぶ"| UD
  F6 -.->|"同じ useRowActions を共有する"| RA

  style UD stroke-width:3px
  style RA stroke-width:3px
```

**要点**

- **不変条件（コード強制）**: chrome API の削除が成功したときだけ索引を触る。`remove` が reject したら即 return して索引もアンドゥも登録しない (`useRowActions.ts:80-86`)
- **別名の削除失敗は握り潰して続行する。** ブックマークは既に消えているので、ここで中断すると復元不能になる。別名の残留はアンドゥ時の `upsert` で上書きされる (`useRowActions.ts:88-94`)
- **復元されたブックマークは別の `id` を持つ。** `create` で新規作成されるため。別名が `urlHash` で紐づいているおかげで ID が変わっても別名は復元できる — この設計判断が効いている場所
- **B の `useUndo` が1つしかない理由**: `useRowActions` が自前で `useUndo` を呼ぶと、`Popup` 側のトースト表示用と別々に `UndoManager` を購読する2つの state ができる。だから `register` は引数として注入されている (`useRowActions.ts:24-27` / `Popup.tsx:50`)
- **期限は二重に守られている。** `setTimeout` と `undoLatest` 内の `Date.now()` 再チェック。バックグラウンドタブでのタイマースロットリング対策 (`UndoManager.ts:55-58`)
- **未確認**: `ensureFolderPath` は空配列のとき `root.children[0]` を「ブックマークバー」と仮定する (`bookmarkService.ts:159-164`)。ロケールやプロファイルでこの順序が保証されるかは確かめていない

---

## 全体にかかる不変条件

- **UI は `chrome.*` を直接呼ばない。** `pages/popup/src/` に `chrome.` の実呼び出しは存在しない（grep 済み。コメントとテストデータのみ）。**コードでは強制されていない規約**で、破っても型チェックも lint も通る
- **文字列比較は必ず `Normalizer` を通る。** 検索照合・別名の重複判定・URL 紐付けの3箇所すべて。生の `includes` / `===` で比較する差分は疑う
- **`packages/storage` は `packages/shared` に依存しない。** 循環になるため。実体は `services.ts` が注入し、構造的インターフェースでしか受けない（各 B 図の `normalizer` への破線）
- **純粋ロジックは React/chrome から切り離す。** `modeMachine` / `inlineEditModel` / `aliasEditorModel` / `folderTreeModel` / `virtualization` / `Normalizer` / `fuzzy` / `UndoManager` はすべて依存ゼロで単体テストされている。宣言を非 export にしてファイル末尾で export をまとめる書式も統一されている
- **外部通信はゼロ。** フォントも woff2 で同梱し CDN を使わない (`pages/popup/src/index.tsx:1-10`)。権限は `bookmarks` / `storage` / `activeTab` / `favicon` の4つのみ (`manifest.ts:33`)

## 意外な点

- **`AliasEditor` だけが `modeMachine` を使っていない。** `InlineEdit` は `resolveKeyIntent('INLINE_EDIT', e)` を経由するのに、`AliasEditor` は `e.key === 'Enter'` 等を直接判定する (`AliasEditor.tsx:159-186`)。そのため `alias:confirm` / `alias:exit` / `alias:candidate-*` の4インテントは定義とテストだけが存在し、本番の消費者がいない (`modeMachine.ts:108-111`)
- **行のダブルクリックは、編集に入る前に「開く」も発火する。** `onClick`（既定は開く）と `onDoubleClick`（インライン編集）が同じ `<button>` に付いており (`ResultRow.tsx:142-143`)、ブラウザは dblclick の前に click を発火する。つまり編集しようとダブルクリックすると裏で現在タブが遷移する。**コードから読み取れる挙動で、実機では未確認**
- **`FolderTree.tsx:17` の JSDoc が腐っている。** 「配下（サブフォルダ含む）へ絞り込む」と書いてあるが、U6a 以降の実装は直下のみ
- **ブックマークツリーを2回、別々に読む**（フロー1と4-B の破線）。結果を別々に保持するので、左ペインの件数は索引の変化に追従しない
- **`localStateStore` / `settingsStore` は定義済みだが誰も使っていない。** U11・U19 待ちの前倒し実装
- **`background/index.ts` はボイラープレートのまま**（9行。テーマをログに出すだけ）。この拡張は実質 Popup だけで完結している
- **`AliasStore.loadIndex` と `SearchEngine.loadIndex` は同名の別物。** 前者は private で、`chrome.storage` 上の `alias_index`（`urlHash` → チャンク番号の逆引き表）を読む

## 未解明

- **テストの現況は未確認。** `pnpm test` を実行していない。ユニットテストの分量は十分にある（`SearchEngine.test.ts` 408行、`aliasStore.test.ts` 298行、`modeMachine.test.ts` 285行）が、いま緑かどうかは見ていない
- **sync → local フェイルオーバーは実機未検証。** `isQuotaExceeded` はエラーメッセージの `/quota/i` で判定している (`aliasStore.ts:265`)。実際の Chrome が返す文言と一致するかはモック上でしか確かめられていない
- **ダブルクリックで現在タブが遷移する件**が実際に起きるか、また意図的な妥協なのかは未確認
- **`AliasEditor` が `modeMachine` を経由しない**のが意図的な判断なのか実装漏れなのかは、コードとコミットメッセージからは判断できなかった
- **左ペインの件数が削除後に更新されない件**が U11 での解消待ちなのか見落としなのかも同様

## 理解できたか確認する

1. 別名を1つ追加したとき、`chrome.storage` への書き込みと画面の更新はどちらが先か。逆順にすると何が起きるか
2. インライン編集でタイトルと URL を両方変え、URL の更新だけが失敗した。このとき画面・索引・実データはそれぞれどうなっているか
3. 「フォルダスコープにサブフォルダも含める」を復活させたい。触るファイルはいくつで、そのうち型を変える必要があるのはどれか
4. `Normalizer` に新しいメソッドを足すのではなく、`normalizeText` の引数を1つ増やしたい。どの依存グラフのどの線が壊れるか
5. 索引を書き換えたのに `refresh()` を呼び忘れた差分がある。どんな症状で、なぜ再現しにくいか
