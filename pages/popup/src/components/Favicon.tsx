import { avatarFor } from '../lib/avatar.js';
import { bookmarkService } from '../services.js';
import { useEffect, useState } from 'react';

interface FaviconProps {
  /** 対象ブックマークの URL。 */
  url: string;
  /** 一辺の px（既定16）。 */
  size?: number;
}

/**
 * ファビコン（既定16×16・角丸4）。取得失敗（`<img>` onError）や URL 空のときは頭文字アバターへ切り替える。
 * 枠は同一寸法・同一角丸で固定し、切替でレイアウトが動かない（docs/design「頭文字アバター」）。
 * ファビコン URL 生成（`chrome.runtime.id` 依存）はデータ層 `BookmarkService.faviconUrl` に閉じ込め済み。
 */
export const Favicon = ({ url, size = 16 }: FaviconProps) => {
  const [failed, setFailed] = useState(false);
  // url が変わったら取得失敗フラグをリセットする（行の再利用でアバターが残らないように）。
  useEffect(() => setFailed(false), [url]);

  if (failed || !url) {
    const { initial, color } = avatarFor(url);
    return (
      <span
        className="flex flex-none items-center justify-center rounded font-bold leading-none text-white"
        style={{ width: size, height: size, backgroundColor: color, fontSize: 9 }}
        aria-hidden="true">
        {initial}
      </span>
    );
  }

  return (
    <img
      src={bookmarkService.faviconUrl(url, size)}
      width={size}
      height={size}
      alt=""
      className="flex-none rounded"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
};
