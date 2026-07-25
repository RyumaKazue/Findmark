/**
 * 頭文字アバター（ファビコン取得失敗時のフォールバック）の算出。
 *
 * ブラウザ描画・React・chrome API に依存しない純粋関数。UI（`Favicon.tsx`）は結果を受け取り描画するだけ。
 * 色・寸法・頭文字の仕様は docs/design/README.md「頭文字アバター」を正とする。
 */

/** URL からホスト名（先頭の `www.` は除去）を取り出す。不正な URL は `null`。 */
const bareHost = (url: string): string | null => {
  try {
    const host = new URL(url).hostname;
    return host ? host.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
};

/** FNV-1a 32bit（同期・純粋）。`Normalizer.hashUrl` と同系の軽量ハッシュ。 */
const fnv1a = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** 頭文字アバターの表示情報。 */
interface Avatar {
  /** 表示する頭文字（大文字）。ホスト先頭の英数字。取れなければ `#`。 */
  initial: string;
  /** 背景色（`AVATAR_PALETTE` から固定割当）。 */
  color: string;
}

/**
 * 頭文字アバターのパレット（docs/design/README.md の9色）。
 * 同一ドメインは常に同色にするため、ホスト名ハッシュで index を固定する。
 */
const AVATAR_PALETTE = [
  '#2E7CF6',
  '#E8862B',
  '#2F74C0',
  '#1F2430',
  '#C0447B',
  '#6D5AE0',
  '#2B8FB8',
  '#4B8B3B',
  '#7A5AC8',
] as const;

/**
 * ファビコン取得失敗時に表示する頭文字アバターを算出する（純粋関数）。
 * - 色: ホスト名（`www.` 除去後）の FNV ハッシュ % パレット長。**同一ドメインは常に同色**。
 * - 頭文字: ホスト先頭の英数字を大文字化。取れなければ `#`。
 */
const avatarFor = (url: string): Avatar => {
  const host = bareHost(url);
  if (!host) {
    return { initial: '#', color: AVATAR_PALETTE[0] };
  }
  const match = host.match(/[a-z0-9]/i);
  const initial = match ? match[0].toUpperCase() : '#';
  const color = AVATAR_PALETTE[fnv1a(host) % AVATAR_PALETTE.length];
  return { initial, color };
};

export { AVATAR_PALETTE, avatarFor };
export type { Avatar };
