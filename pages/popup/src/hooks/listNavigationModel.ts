/**
 * 結果リスト上の選択インデックス移動の純粋ロジック（`list-arrow-wrap`）。
 *
 * React / `chrome.*` / DOM に非依存の純粋関数であり、`Popup.tsx`（React 層）とユニットテスト
 * （`listNavigationModel.test.ts`）から利用する。既存の pure module（`modeMachine.ts` / `selectionModel.ts` /
 * `sessionModel.ts`）に倣い、宣言は非 export とし、ファイル末尾で export をまとめる。
 *
 * **端で循環する**（先頭で `↑` → 末尾 / 末尾で `↓` → 先頭）。従来は `Popup.tsx` 内の
 * `Math.max(i - 1, 0)` / `Math.min(i + 1, lastIndex)` で端をクランプしていたが、
 * 「キーを押しても何も起きない」体験と末尾への到達性の悪さを解消するため循環へ改めた
 * （`docs/functional-design.md`「既定モードのキー挙動(フォーカス位置別)」も同時に更新済み）。
 *
 * `modeMachine.ts` に置かない理由: 同ファイルは「キー → インテント」の意味論に責務を限定しており、
 * 結果件数という UI 状態を引数に取るインデックス計算は責務が異なる（混ぜると `modeMachine` が肥大化する）。
 */

/**
 * 選択インデックスを `delta` だけ動かす（端で循環）。
 *
 * - `count <= 0`（結果 0 件）は `0` を返す。Popup は「結果なし」も `selectedIndex === 0` で表すため。
 * - `current` が範囲外（結果件数の変動と keydown が交錯した場合など）でも、戻り値は必ず
 *   `0 <= n < count` に収まる。JS の `%` は被除数の符号を返す（`-1 % 5 === -1`）ため、
 *   `((x % n) + n) % n` の定石で 0 以上へ正規化し、循環と範囲外の吸収を分岐なしの 1 式で行う。
 * - `delta` を `-1 | 1` に狭めず `number` で受けるのは、将来 `PageUp` / `PageDown`（例: ±10）を
 *   追加する際に同じ関数を再利用できるようにするため（本単位では ±1 のみ使用する）。
 */
const moveSelectionIndex = (current: number, delta: number, count: number): number => {
  if (count <= 0) {
    return 0;
  }
  return (((current + delta) % count) + count) % count;
};

export { moveSelectionIndex };
