# 設計: folder-ui-affordance（フォルダ選択 UI の操作可能性の是正）

- **作業単位名**: `folder-ui-affordance`
- **作成日**: 2026-08-15
- **前提**: [requirements.md](./requirements.md)

---

## 1. 方針

独立した2つの修正を1単位にまとめる。共通するのは「**操作できるはずのものが、そう見えていない／動かない**」という欠陥の性質。

| # | 対象 | 方針 |
|---|---|---|
| A | `AddCurrentPanel` のフォルダ候補 | `MovePanel` にしかない追従処理を**共通フックへ切り出し**、両者から使う（重複移植の再発防止） |
| B | `FolderTreeItem` の chevron | 塗りの範囲を**デザインモックに合わせて chevron まで広げ**、chevron に常時の背景を与える |

---

## 2. コンポーネント設計

### 2.1 `pages/popup/src/hooks/useScrollSelectedIntoView.ts`（新規）

**責務**: 「選択中の候補（`[data-selected="true"]`）が可視範囲外なら追従スクロールする」DOM 効果のみ。

```ts
/**
 * 絞り込み候補リストで、選択中の要素（`[data-selected="true"]`）を可視範囲へ追従させる。
 *
 * `MovePanel`（Ctrl/Cmd+M）と `AddCurrentPanel`（Ctrl/Cmd+D）はどちらも `movePanelModel` を共有した
 * 同じ形の候補リストを持つが、この追従処理は `MovePanel` にしか無く、`AddCurrentPanel` では
 * `↑↓` を押しても選択が画面外へ出たままになる欠陥があった。同じ実装を2箇所に置くと再発するため、
 * 1つのフックに集約して両者から呼ぶ。
 *
 * `block: 'nearest'` により、可視範囲内にあるときは何もせず、外に出たときだけ最小限スクロールする
 * （選択が常に中央へ飛ぶ落ち着かない動きを避ける）。
 *
 * @param listRef スクロールコンテナ（`overflow-y-auto` を持つ要素）への ref
 * @param deps 選択位置・候補配列など、追従を再評価すべき値
 */
const useScrollSelectedIntoView = (listRef: RefObject<HTMLElement | null>, deps: readonly unknown[]): void => {
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    // 呼び出し側が「選択位置・候補配列」を渡す規約。listRef は ref のため依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
};
```

> **`deps` を引数で受ける形にする理由**: 追従の再評価タイミング（`index` の変化 / 絞り込み結果の変化）は
> 呼び出し側の state に依存する。フック内部で固定すると `MovePanel` と `AddCurrentPanel` で微妙に異なる
> 依存を表現できない。`useEffect` の deps をそのまま透過させる、薄いラッパとして定義する。

**配置理由**: `docs/repository-structure.md` の「React hooks は `pages/*/src/hooks/`（`useXxx.ts`）」に従う。
DOM に触れるため `packages/` には置かない（`packages/shared` は DOM 依存禁止）。

### 2.2 `MovePanel.tsx`（変更）

既存の `useEffect`（L75-78）をフック呼び出しに置き換えるだけ。挙動は不変（AC-2）。

```ts
useScrollSelectedIntoView(listRef, [index, filtered]);
```

### 2.3 `AddCurrentPanel.tsx`（変更）

3点を追加する。

1. 候補リストのスクロールコンテナに `folderListRef` を付ける（現在 ref が無い）。
2. 候補ボタンに `data-selected={i === folderIndex}` を付ける（現在は `className` の三項演算子のみで、
   選択状態が DOM 属性に出ていないため `querySelector` で拾えない）。
3. `useScrollSelectedIntoView(folderListRef, [folderIndex, filtered])` を呼ぶ。

> **`data-selected` を付ける副次効果**: 選択状態が DOM 属性として観測可能になり、`MovePanel` と表現が揃う。

### 2.4 `FolderTreeItem.tsx`（変更）— フォルダ行の構造

**現状**（塗りが「名前ボタン」だけに掛かる）:

```
<div class="flex h-[30px] items-center">
  <IndentGuides/>
  <button chevron class="size-5 ..."/>              ← 塗りの外（＝明るい背景の上）
  <button name    class="flex-1 ... bg-accent"/>    ← ここだけ塗られる
</div>
```

**変更後**（デザインモック L61 と同じ「1つの塗られた行」）:

```
<div class="flex h-[30px] items-center">
  <IndentGuides/>                                    ← 塗りの外に残す（design 2a のガイド線）
  <div class="flex h-[30px] flex-1 items-center gap-[6px] rounded-md px-1.5 [塗り]">
    <button chevron class="size-5 ... [常時背景]"/>  ← 塗りの内側
    <button name    class="flex-1 ..."/>             ← 背景は持たない（塗りは親が持つ）
  </div>
</div>
```

**塗り（内側ラッパ）のクラス**:

| 状態 | クラス |
|---|---|
| `scopedStrong`（スコープ中 + 左ペインがアクティブ） | `bg-accent text-white font-bold` |
| `scopedMuted`（スコープ中 + 非アクティブ） | `bg-accent-bg text-accent-strong font-bold` |
| 非スコープ | `text-ink-2 hover:bg-accent-bg` |
| `dropTarget`（D&D） | `outline-accent outline-dashed outline-2 -outline-offset-2` |

> これまで「名前ボタン」に付けていた背景・角丸・フォント・`dropTarget` の outline を、そのまま内側ラッパへ移す。
> `hover:bg-accent-bg` も**ラッパ側**に移すことで、行のどこにホバーしても行全体が反応する（現在は名前部分のみ）。

**chevron のクラス（AC-4: 常時の操作可能性）**:

| 状態 | 静止 | ホバー |
|---|---|---|
| `scopedStrong` | `bg-white/20 text-white` | `hover:bg-white/35` |
| `scopedMuted` | `bg-accent/15 text-accent-strong` | `hover:bg-accent/25` |
| 非スコープ | 背景なし・`text-triangle` | `hover:bg-accent-bg` |

- **色**: `scopedStrong` は `text-white/75` → **`text-white`**（不透明）へ上げる。塗りの中で確実に読める。
- **静止時の背景**: スコープ中の行だけ、chevron に半透明のピル（`rounded` は既存のまま）を敷く。
  「押せる領域がここにある」ことがマウスを動かさなくても分かる（キーボード操作中でも手掛かりが出る）。
- **非スコープ行は変更しない**: 全行に背景を出すと 220px の左ペインが煩雑になるため（requirements「解釈で埋めた点」#2）。
- **`title` 属性を追加**: `aria-label` はスクリーンリーダー用でツールチップにならない。マウス利用者向けに
  `title={expanded ? t('popupTreeCollapse') : t('popupTreeExpand')}` を付ける（既存の i18n キーを再利用）。

**変更しないもの（AC-5）**:
- 押下対象の分離（chevron = 展開 / 名前 = スコープ選択）。
- `onMouseDown={preventFocusSteal}`（クリックでフォーカスを奪わない）。
- ~~`data-folder-id`（D&D の `elementFromPoint` 判定に使う）— **名前ボタンに残す**~~
  → **実装時に判断を訂正し、内側ラッパへ移した**。`dropTarget` のハイライト outline はラッパが持つため、
  `data-folder-id` を名前ボタンに残すと**光っている範囲より実際に落とせる範囲が狭くなる**
  （chevron の上・ラッパの padding 上・chevron と名前の間の gap 上でドロップが効かない）。
  判定は `closest('[data-folder-id]')` で上方向に辿るため、ラッパに置けば chevron 上でも名前上でもヒットする。
  **ハイライトと当たり判定は同じ要素に置く**のが正しい（結果として当たり判定はわずかに広がる）。
- 行高 30px、`IndentGuides`、子なしフォルダの空枠（`size-5`）。
- 「すべて」行・「さらに N 件…」行（塗りが単一ボタンで完結しており本問題は起きない）。

---

## 3. データフロー

### UC-1: 追加ダイアログで `↓` を押す（AC-1）

```
1. keydown(ArrowDown) → handleFolderKeyDown が stopPropagation（Popup の document リスナーへ渡さない）
2. setFolderIndex(i => clampIndex(i + 1, filtered.length))
3. 再レンダー: i === folderIndex の候補が data-selected="true" になる
4. useScrollSelectedIntoView の effect が発火（deps: [folderIndex, filtered]）
5. listRef 内の [data-selected="true"] を scrollIntoView({ block: 'nearest' })
   → 可視範囲内なら何もせず、外に出ていたら最小限スクロール
```

### UC-2: 左ペインでスコープが当たる（AC-3 / AC-4）

```
1. scopeFolderId が当該フォルダになる → scoped = true
2. paneFocused（左ペインがアクティブか）と組み合わせて scopedStrong / scopedMuted を決定
3. 内側ラッパが bg-accent（または bg-accent-bg）で塗られる
   → chevron はこの塗りの内側にあるため、白（または accent 濃色）で確実に読める
4. chevron 自身も bg-white/20（または bg-accent/15）のピルを持つ
   → 静止状態でも「押せる領域」として認識できる
```

---

## 4. エラーハンドリング戦略

新規のエラー経路は無い。

- `useScrollSelectedIntoView` は `listRef.current?.querySelector(...)?.scrollIntoView(...)` と
  **二重のオプショナルチェーン**で、ref 未設定・選択要素なしのいずれでも何もせず終わる（既存 `MovePanel` と同じ）。
- 見た目の変更は Tailwind クラスのみで、実行時の失敗経路を持たない。

---

## 5. テスト戦略

**新規のユニットテストは追加しない（追加できない）。**

変更対象は (1) DOM 効果（`scrollIntoView`）、(2) Tailwind のクラス指定、(3) DOM 構造の入れ子変更 の3点のみで、
切り出せる純粋ロジックが無い。本プロジェクトは「純粋ロジックのみユニットテストし、React コンポーネント自体の
テストは持たない」方針（U11 申し送り）のため、この範囲はテスト対象外となる。

- **回帰の担保**: 既存テスト（`movePanelModel.test.ts` / `folderTreeModel.test.ts` 等 209 件）が
  引き続き通ることを品質ゲートで確認する。今回はこれらが参照するモデル層に一切触れないため、
  落ちる場合は想定外の巻き込みを意味する。
- **受け入れの担保**: 実機確認（ゲート2）で AC-1〜AC-5 を目視確認する。特に AC-3/AC-4 は
  **見た目の問題であり、そもそも自動テストでは検証できない**（前単位までの手戻りも同種）。

> **将来の改善余地**: `AddCurrentPanel` に追従処理が無かったのは「同じ実装が2箇所に必要なのに片方だけ移植した」
> ことが原因で、テストではなく**共通化**で防ぐのが筋。本単位のフック切り出しがその対策になる。

---

## 6. ディレクトリ構造（変更対象）

```
pages/popup/src/
├── hooks/
│   └── useScrollSelectedIntoView.ts   # ★新規: 選択候補のスクロール追従
└── components/
    ├── MovePanel.tsx                  # 変更: 既存 useEffect をフック呼び出しへ置換（挙動不変）
    ├── AddCurrentPanel.tsx            # 変更: ref + data-selected + フック呼び出しを追加
    └── FolderTreeItem.tsx             # 変更: 塗りを内側ラッパへ移動 / chevron に常時背景と title

docs/
└── functional-design.md               # 変更: デザイン非採用項目 #12 を追記
```

---

## 7. 実装の順序

1. `useScrollSelectedIntoView.ts` を作成
2. `MovePanel.tsx` を置き換え（挙動不変であることを確認）
3. `AddCurrentPanel.tsx` に追従を追加
4. `FolderTreeItem.tsx` の構造とクラスを変更
5. ドキュメント整合（デザイン非採用項目 #12）
6. `implementation-validator` → 品質ゲート（フォアグラウンドで exit code 確認）

## 8. 依存ライブラリ

追加なし。

## 9. セキュリティ考慮事項

該当なし（DOM のスクロールと CSS クラスのみ。外部入力・権限・ストレージに触れない）。

## 10. パフォーマンス考慮事項

- `scrollIntoView` は `↑↓` 1回につき最大1回。`MovePanel` で既に同じコストを払っており増分は無い。
- `FolderTreeItem` は DOM が1階層深くなる（内側ラッパの `div` が増える）。左ペインの可視行は
  深さ省略（design 2b）により高々数十行のため、影響は無視できる。

## 11. 将来の拡張性

- `useScrollSelectedIntoView` は `[data-selected="true"]` という DOM 契約だけに依存するため、
  今後追加する候補リスト（`AliasEditor` の候補等）にもそのまま適用できる。
- chevron の「常時背景」は現在スコープ行のみだが、全行へ広げたくなった場合はクラスの条件を外すだけで済む。
