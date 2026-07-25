// デザイン指定フォント（docs/design）を woff2 で同梱する。CDN は使わない（CSP・外部通信ゼロ・オフライン）。
// 必要ウエイト（Noto Sans JP 400/500/700・IBM Plex Mono 400/500）× 必要サブセット（latin + japanese）のみを取り込む。
import '@fontsource/noto-sans-jp/latin-400.css';
import '@fontsource/noto-sans-jp/latin-500.css';
import '@fontsource/noto-sans-jp/latin-700.css';
import '@fontsource/noto-sans-jp/japanese-400.css';
import '@fontsource/noto-sans-jp/japanese-500.css';
import '@fontsource/noto-sans-jp/japanese-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@src/index.css';
import Popup from '@src/Popup';
import { createRoot } from 'react-dom/client';

const init = () => {
  const appContainer = document.querySelector('#app-container');
  if (!appContainer) {
    throw new Error('Can not find #app-container');
  }
  const root = createRoot(appContainer);

  root.render(<Popup />);
};

init();
