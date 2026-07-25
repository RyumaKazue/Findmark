/**
 * 検索結果 0 件時のみ使うあいまい一致（Levenshtein 距離ベース）のヘルパ。
 *
 * ブラウザ描画・React・chrome API・DOM に依存しない純粋関数の集合であり、
 * 単体テスト可能に保つ（architecture.md のレイヤー依存 UI→サービス→データ の起点）。
 * 辞書は同梱しない（ローマ字/読みは別名登録で対応する方針）。
 */

/**
 * `pattern` と `text` の任意の部分文字列との最小編集距離を返す。
 *
 * 通常の Levenshtein 距離（2 文字列全体の距離）ではなく、`text` 内の任意の開始位置から
 * `pattern` に最も近い部分文字列を探す「部分文字列マッチング」の距離。
 * DP の 0 行目を全て 0 で初期化する（`pattern` の先頭が `text` のどの位置からでも
 * 始まってよいことを表す）ことで実現する。
 *
 * @example approxSubstringDistance('git', 'my github repo') === 0  // 'git' が完全一致で含まれる
 * @example approxSubstringDistance('gti', 'github') === 1          // 'gi'(部分文字列) への1文字挿入で到達可能
 */
export const approxSubstringDistance = (pattern: string, text: string): number => {
  const m = pattern.length;
  const n = text.length;
  if (m === 0) {
    return 0;
  }
  if (n === 0) {
    return m;
  }

  // dp[j] は「pattern の先頭 i 文字」と「text の何らかの開始位置から j 文字目まで」の距離。
  // 0 行目（i=0）は全て 0（pattern の先頭は text のどこから始まってもよい）。
  let prev = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1).fill(0);
    curr[0] = i; // pattern の先頭 i 文字を全て挿入するコスト
    for (let j = 1; j <= n; j++) {
      const cost = pattern[i - 1] === text[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // 削除（pattern 側の文字を消費して不一致扱い）
        curr[j - 1] + 1, // 挿入
        prev[j - 1] + cost, // 置換 or 一致
      );
    }
    prev = curr;
  }

  // 最終行（i=m）の最小値が「text 中のどこかに現れる pattern に最も近い部分文字列」との距離。
  return Math.min(...prev);
};

/**
 * キーワード長に応じたあいまい一致の許容編集距離を返す。
 * 短いキーワードほど誤爆しやすいため厳しめのしきい値にする。
 *
 * @example fuzzyThreshold(4) === 1
 * @example fuzzyThreshold(5) === 2
 */
export const fuzzyThreshold = (len: number): number => (len <= 4 ? 1 : 2);
