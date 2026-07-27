/**
 * 検索語・被検索文字列・別名・URL の正規化を担うドメインロジック。
 *
 * ブラウザ描画・React・chrome API・DOM に依存しない純粋関数の集合であり、
 * 単体テスト可能に保つ（architecture.md のレイヤー依存 UI→サービス→データ の起点）。
 *
 * - `normalizeText`: テキストの同値化（検索照合・別名の重複判定に使う）
 * - `normalizeUrl` / `hashUrl`: URL を別名紐付けキーへ変換（登録時・読み出し時の双方で使う）
 */
export class Normalizer {
  /**
   * 検索/別名比較用のテキスト正規化。
   * `NFKC`（全角半角・半角カナ→全角カナを吸収）→ 小文字化 → カタカナ→ひらがな統一。
   *
   * 順序が重要: 先に NFKC を適用することで半角カナも `ァ-ヶ` の範囲に入り、ひらがな化される。
   *
   * @example normalizeText('ＧitＨｕｂ') === 'github'
   * @example normalizeText('ｷﾞｯﾄ') === 'ぎっと'
   */
  normalizeText(input: string): string {
    return input
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }

  /**
   * URL 紐付けキー用の正規化。同じページを指す表記ゆれを 1 つの正規形へ寄せる。
   * - フラグメント（`#...`）は保持する。ハッシュルーティングの SPA（例: `.../new#settings/usage`）では
   *   フラグメントがページを識別するため、除去すると別ページが同一キーに衝突し別名レコードを共有してしまう。
   *   Chrome もフラグメント違いを別ブックマークとして保持するため、別名の同一性も URL 全体（フラグメント含む）に揃える。
   * - 末尾スラッシュを正規化（`/path/` → `/path`。ただしルート `/` 単体は保持）
   * - クエリ（`?...`）は保持（異なるクエリは別ページとみなし、誤結合を防ぐ）
   *
   * 前提: 呼び出し側は有効な絶対 URL を渡すこと。不正な URL の場合、`new URL()` が
   * `TypeError` を throw する。Normalizer は握り潰さず throw を素通しする（早期失敗）。
   *
   * @example normalizeUrl('https://ex.com/a/b/?ref=x#top') === 'https://ex.com/a/b?ref=x#top'
   */
  normalizeUrl(raw: string): string {
    const u = new URL(raw);
    if (u.pathname.endsWith('/') && u.pathname !== '/') {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.protocol + '//' + u.host + u.pathname + u.search + u.hash;
  }

  /**
   * `normalizeUrl` の結果を FNV-1a(32bit) で同期ハッシュ化し、符号なし 16 進文字列を返す。
   * `crypto.subtle.digest` は非同期のため採用しない（同期・決定的であることが要件）。
   *
   * 同じ正規化 URL からは常に同じハッシュが得られる（`AliasRecord.urlHash` の生成に使う）。
   *
   * @throws {TypeError} `raw` が不正な URL の場合（`normalizeUrl` 経由）。
   */
  hashUrl(raw: string): string {
    const s = this.normalizeUrl(raw);
    let h = 0x811c9dc5; // FNV offset basis (32bit)
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193); // FNV prime
    }
    return (h >>> 0).toString(16); // 符号なし 16 進
  }
}

/** 既定の Normalizer インスタンス。状態を持たないため使い回して問題ない。 */
export const normalizer = new Normalizer();
