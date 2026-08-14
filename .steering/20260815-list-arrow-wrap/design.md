# 設計: list-arrow-wrap（LIST モードの ↑↓ 循環ナビゲーション）

- **作業単位名**: `list-arrow-wrap`
- **作成日**: 2026-08-15
- **前提**: [requirements.md](./requirements.md)

---

## 1. 方針

**インデックス移動の計算だけを純粋関数に切り出し、`Popup.tsx` はその結果を `setSelectedIndex` に流すだけにする。**

キー意味論（どのキーがどのインテントか）は既に `modeMachine.ts` が持ち、`Popup.tsx` はインテントを実行するだけの構造になっている。
今回変わるのは「インテント実行時のインデックス計算」のみであり、**`modeMachine.ts`（インテント定義）は一切変更しない**。
現在その計算は `Popup.tsx` 内に `Math.max(i - 1, 0)` / `Math.min(i + 1, lastIndex)` としてインラインで 3 箇所（`move-up` / `move-down` / `leaveSearch`）に散っている。
これを 1 つの純粋関数へ集約することで、循環規則が 3 箇所で食い違う事故を構造的に防ぎ、AC-7（純粋関数のユニットテスト）を満たす。

```
KeyboardEvent
   │
   ▼
resolveKeyIntent(mode, e, listFocus)      ← modeMachine.ts（変更なし）
   │  'list:move-up' / 'list:move-down' / 'list:leave-search-up' / 'list:leave-search-down'
   ▼
Popup.tsx（React 層）
   │  setSelectedIndex(i => moveSelectionIndex(i, delta, results.length))
   ▼
moveSelectionIndex()                      ← ★新規: listNavigationModel.ts（純粋・テスト対象）
   │
   ▼
selectedIndex state → ResultList（既存のスクロール追従が働く）
```

---

## 2. コンポーネント設計

### 2.1 `pages/popup/src/hooks/listNavigationModel.ts`（新規・純粋モジュール）

**責務**: 結果リスト上の選択インデックスの移動計算。React / `chrome.*` / DOM に非依存。

**API**:

```ts
/**
 * 選択インデックスを delta だけ動かす（端で循環）。
 * count が 0 のときは 0 を返す（結果なし = 選択なしを 0 で表す既存の約束に合わせる）。
 * current が範囲外（結果件数の変動直後など）でも、戻り値は必ず 0 <= n < count に収まる。
 */
const moveSelectionIndex = (current: number, delta: number, count: number): number => {
  if (count <= 0) {
    return 0;
  }
  return (((current + delta) % count) + count) % count;
};
```

**実装の要点**:

- **負数対応の剰余**: JS の `%` は被除数の符号を返すため（`-1 % 5 === -1`）、`((x % n) + n) % n` の定石で 0 以上に正規化する。
  これにより `current = 0, delta = -1` → `count - 1`（末尾へ循環）が 1 式で表せ、`if` による分岐が不要になる。
- **`current` が範囲外でも安全**: 剰余で必ず `[0, count)` に落ちるため、結果件数の変動と keydown が交錯しても不正なインデックスにならない（AC-4）。
- **`delta` は `-1 | 1` に限定しない**: 将来 `PageUp`/`PageDown` を追加する際に同じ関数を再利用できるよう `number` で受ける
  （ただし本単位では ±1 のみ使用する）。
- 既存の pure module（`modeMachine.ts` / `folderTreeModel.ts` / `selectionModel.ts`）に倣い、**宣言は非 export とし、ファイル末尾で export をまとめる**。

**配置理由**: `docs/repository-structure.md` の「React hooks は `pages/*/src/hooks/`」に従いつつ、
既に同ディレクトリに純粋モジュール（`modeMachine.ts` / `selectionModel.ts` / `sessionModel.ts` / `bulkActionsCore.ts`）が同居している慣例に合わせる。
`components/` 側の pure module（`folderTreeModel.ts` 等）は特定コンポーネント専用のため、キー操作由来の本ロジックは `hooks/` が適切。

> **`modeMachine.ts` に入れない理由**: 同ファイルは「キー → インテント」の意味論に責務を限定しており、
> 結果件数という UI 状態を引数に取るインデックス計算は責務が異なる。混ぜると `modeMachine` が肥大化する。

### 2.2 `pages/popup/src/Popup.tsx`（変更）

**責務変更なし**。インデックス計算を `moveSelectionIndex` に委譲するだけ。

**変更点**:

| 箇所 | 変更前 | 変更後 |
|---|---|---|
| `leaveSearch`（L197-204） | `setSelectedIndex(i => Math.min(Math.max(i + delta, 0), lastIndex))` / deps `[lastIndex]` | `setSelectedIndex(i => moveSelectionIndex(i, delta, resultCount))` / deps `[resultCount]` |
| `case 'list:move-up'`（L577-580） | `setSelectedIndex(i => Math.max(i - 1, 0))` | `setSelectedIndex(i => moveSelectionIndex(i, -1, resultCount))` |
| `case 'list:move-down'`（L581-584） | `setSelectedIndex(i => Math.min(i + 1, lastIndex))` | `setSelectedIndex(i => moveSelectionIndex(i, 1, resultCount))` |
| `lastIndex`（L147） | `const lastIndex = Math.max(0, results.length - 1)` | **削除**（本変更後、参照が 0 になるため。残すと `no-unused-vars` で lint が落ちる） |
| keydown effect の deps（L715） | `lastIndex` | **削除**（`results.length` は既に deps に含まれるため追加不要） |

**`resultCount` について**: 可読性のため `const resultCount = results.length;` を導入するか、
呼び出し側で直接 `results.length` を渡すかは実装時に決める（deps 配列の既存要素が `results.length` であるため、
**直接 `results.length` を渡して deps を増やさない**方針を第一候補とする）。

> **既存の範囲外クランプ effect（L143-145）は残す**: これは「結果件数が減ったときに選択行を範囲内へ戻す」責務で、
> キー操作とは独立している。循環とは競合しない（循環は常に範囲内の値を返すため、この effect は no-op になる）。

### 2.3 変更しないもの

- `modeMachine.ts` / `modeMachine.test.ts` — インテントの定義・解決は不変。
- `ResultList.tsx` — 選択行の可視化追従（L113-126）は `selectedIndex` の変化に反応するため、
  循環による大ジャンプ（0 → N-1）でも `el.scrollTop = rowBottom - el.clientHeight` が働き末尾行が可視になる（AC-5）。**変更不要**。
- `FolderTree.tsx` / `FolderTreeActions.moveFocus` — 左ペインはクランプのまま（AC-6・スコープ外）。
- `AliasEditor` / `MovePanel` / `AddCurrentPanel` の候補移動 — 変更しない（AC-6）。

---

## 3. データフロー

### UC-1: 右ペインで先頭行から `↑`（AC-1）

```
1. keydown(ArrowUp) → mode='LIST', listFocus='result'
2. resolveKeyIntent → 'list:move-up'
3. e.preventDefault()
4. setSelectedIndex(i => moveSelectionIndex(0, -1, N))  // → N-1
5. ResultList の追従 effect: rowBottom((N-1)*56+56) > scrollTop + clientHeight → 末尾までスクロール
```

### UC-2: 検索ボックスで先頭行から `↑`（AC-3）

```
1. keydown(ArrowUp) → mode='LIST', listFocus='search'
2. resolveKeyIntent → 'list:leave-search-up'
3. leaveSearch(-1):
   a. setListFocus('result')          // 以降 ←→ がペイン移動に使える（U8a の既存挙動）
   b. searchInputRef.current.blur()
   c. setSelectedIndex(i => moveSelectionIndex(0, -1, N))  // → N-1
```

### UC-3: 結果 0 件で `↓`（AC-4）

```
1. resolveKeyIntent → 'list:move-down'
2. moveSelectionIndex(0, 1, 0) → 0（count<=0 のガード）
3. 選択インデックスは 0 のまま。ResultList は results.length===0 で早期 return するためスクロールも起きない
```

---

## 4. エラーハンドリング戦略

新規のエラー経路は無い。`moveSelectionIndex` は全域関数（total function）であり例外を投げない。
異常系は「不正な `count`（0 以下）」と「範囲外の `current`」の 2 つで、いずれも戻り値を安全な範囲に丸めることで吸収する（防御的デフォルト）。
これは既存の `modeMachine.modeReducer` が不正遷移を現状維持に倒す方針と同じ考え方。

---

## 5. テスト戦略

### ユニットテスト: `pages/popup/src/hooks/listNavigationModel.test.ts`（新規・co-located）

vitest。`pages/popup` の既存テスト（`modeMachine.test.ts` 等）と同じ構成。

| # | ケース | 期待値 |
|---|---|---|
| 1 | 中間から `-1` | `moveSelectionIndex(3, -1, 10) === 2` |
| 2 | 中間から `+1` | `moveSelectionIndex(3, 1, 10) === 4` |
| 3 | 先頭から `-1`（AC-1） | `moveSelectionIndex(0, -1, 10) === 9` |
| 4 | 末尾から `+1`（AC-2） | `moveSelectionIndex(9, 1, 10) === 0` |
| 5 | 1 件のとき `-1` / `+1`（AC-4） | どちらも `0` |
| 6 | 0 件のとき `-1` / `+1`（AC-4） | どちらも `0` |
| 7 | `count` が負（防御的） | `0` |
| 8 | `current` が範囲外（上振れ・下振れ）（AC-4） | 戻り値が `0 <= n < count` に収まる |
| 9 | `delta` が 0 | 現在値をそのまま返す（範囲内に正規化される） |

### 手動確認（ゲート2 で提示）

- 実機（`pnpm dev` + 拡張読み込み）で AC-1〜AC-3・AC-5 を確認する。
- AC-6（左ペイン・パネル系が従来どおり）を回帰確認する。

> **React コンポーネントの結合テストは行わない** — U11 の申し送りどおり、本プロジェクトは「純粋ロジックのみテストし、
> React コンポーネント自体のテストは持たない」方針。今回の変更は純粋関数に閉じるためこの方針で十分カバーできる。

---

## 6. ディレクトリ構造（変更対象）

```
pages/popup/src/
├── hooks/
│   ├── listNavigationModel.ts        # ★新規: moveSelectionIndex（純粋）
│   ├── listNavigationModel.test.ts   # ★新規: ユニットテスト
│   └── modeMachine.ts                # 変更なし
├── Popup.tsx                         # 変更: 3箇所を moveSelectionIndex へ / lastIndex 削除
└── components/ResultList.tsx         # 変更なし（既存のスクロール追従で AC-5 を満たす）

docs/
└── functional-design.md              # 変更: キー挙動表「端では何もしない」→「端で循環」
```

---

## 7. 実装の順序

1. `listNavigationModel.ts` を作成（純粋関数のみ）
2. `listNavigationModel.test.ts` を作成し、単体で緑にする
3. `Popup.tsx` の 3 箇所を差し替え、`lastIndex` と deps を整理
4. `docs/functional-design.md` のキー挙動表を更新
5. `implementation-validator` による検証 → 品質ゲート（フォアグラウンドで exit code 確認）

---

## 8. 依存ライブラリ

追加なし。

## 9. セキュリティ考慮事項

該当なし（純粋な数値計算であり、外部入力・権限・ストレージに触れない）。

## 10. パフォーマンス考慮事項

- `moveSelectionIndex` は O(1) の算術のみ。`setSelectedIndex` の updater 内で呼ぶため再レンダーは従来と同一回数。
- 循環による大ジャンプは `ResultList` の仮想スクロール（`computeWindow`）で描画行数が一定に保たれるため、
  件数が多くても描画コストは増えない。

## 11. 将来の拡張性

- `delta` を `number` で受けるため、`PageUp`/`PageDown`（例: `delta = ±10`）や `Home`/`End` 相当を追加する際も同関数を再利用できる。
  ただし「ページ移動は循環させない」判断もあり得るため、その場合は `clampSelectionIndex` を同モジュールに併設して使い分ける。
- `FOLDER_TREE` や候補リスト（`ALIAS_EDIT` / `PANEL`）の循環を将来入れる場合も、同関数を共有すれば規則の重複定義を避けられる。
