# 設計書

## アーキテクチャ概要

`chrome-extension/manifest.ts` は TypeScript オブジェクトとして manifest を定義し、Vite プラグイン（`utils/plugins/make-manifest-plugin.ts`）がビルド時に `manifest.json` へ変換する。本作業は**この単一ファイルの設定変更が中心**であり、新規コンポーネントやロジックの追加は伴わない。`satisfies ManifestType`（`@extension/shared`）による型制約を維持する。

```
manifest.ts (設定の正)
   │ ビルド時変換 (make-manifest-plugin)
   ▼
dist/manifest.json (Chrome が読む)
```

## コンポーネント設計

### 1. manifest.ts（設定オブジェクト）

**責務**:
- Findmark の権限・エントリポイント・ショートカットを最小構成で宣言する。

**変更方針（現状 → 目標）**:

| キー | 現状 | 目標 | 根拠 |
|------|------|------|------|
| `permissions` | `['storage']` | `['bookmarks', 'storage', 'activeTab', 'favicon']` | architecture.md「最小権限」 |
| `host_permissions` | なし | なし（追加しない） | 外部通信ゼロ・host permission 不要 |
| `content_scripts` | `<all_urls>` にマッチ | 削除 | コンテンツスクリプト不使用。広範警告の回避 |
| `web_accessible_resources` | `*://*/*` へ広範公開 | 最小化（原則削除） | 露出面の最小化 |
| `devtools_page` | `devtools/index.html` | 削除 | MVP 未使用 |
| `commands` | なし | `_execute_action` を追加 | PRD 機能1 ショートカット起動 |
| `action.default_popup` | `popup/index.html` | 維持（確認のみ） | メインUI |
| `options_page` | `options/index.html` | 維持（確認のみ） | インポート/エクスポート・ゴミ箱 |
| `default_locale` | `ja` | 維持 | ja 既定 |
| `browser_specific_settings` | gecko 定義あり | 維持（Chrome ビルドでは parser が除去） | MVP は Chrome 優先。無害なため保持 |

**目標の manifest（要点の擬似コード）**:

```ts
const manifest = {
  manifest_version: 3,
  default_locale: 'ja',
  name: '__MSG_extensionName__',
  browser_specific_settings: { gecko: { id: 'example@example.com', strict_min_version: '109.0' } },
  version: packageJson.version,
  description: '__MSG_extensionDescription__',
  permissions: ['bookmarks', 'storage', 'activeTab', 'favicon'],
  options_page: 'options/index.html',
  background: { service_worker: 'background.js', type: 'module' },
  action: { default_popup: 'popup/index.html', default_icon: 'icon-34.png' },
  icons: { '128': 'icon-128.png' },
  commands: {
    _execute_action: {
      suggested_key: { default: 'Ctrl+Shift+F', mac: 'Command+Shift+F' },
      description: 'Findmark の検索ポップアップを開く',
    },
  },
  // content_scripts: 削除
  // devtools_page: 削除
  // web_accessible_resources: 削除（下記「実装の要点」参照）
} satisfies ManifestType;
```

**実装の要点 / 技術的な制約**:
- **`web_accessible_resources` の扱い**: `favicon` 権限による `chrome-extension://<id>/_favicon/?pageUrl=...` は拡張自身のページ（popup/options）からはネイティブに参照でき、`web_accessible_resources` を必要としない。したがって原則削除する。ただし削除により `pnpm dev`（HMR）または `pnpm build` が破綻する場合は、**壊れない最小パターンへ縮小する方針にフォールバック**する（例: `resources: ['_favicon/*']` 等）。どちらを採ったかは検証時に受け入れ条件と突き合わせて確定する。
- **`content_scripts` 削除に伴う `public/content.css`**: `content.css` を参照するのは削除する `content_scripts` のみ。ビルドが通ることを確認する（public アセット自体の削除は今回のスコープ外で、参照が消えれば未使用となる）。
- **`devtools_page` 削除**: manifest から参照を外すことで devtools ページはロードされなくなる。`pages/devtools*` パッケージ自体は残す（削除は turbo/module-manager 構成への波及があるためスコープ外）。
- **`ManifestType` 制約**: `commands` / 変更後の各キーが `@extension/shared` の `ManifestType` を満たすことを型チェックで担保する。満たさない場合は型定義を確認し、正しいキー構造に修正する。

### 2. `.gitignore`（承認保留・条件付き）

**責務**: 追跡対象の制御。

**実装の要点**:
- requirements.md「未確定の論点」のとおり、`.steering/` を gitignore するか否かは `commit-steering` 運用と矛盾するため**ユーザー判断待ち**。既定推奨は「gitignore しない（現状維持）」であり、その場合 `.gitignore` は変更しない。判断結果に応じてタスクを実行/スキップする。

## データフロー

本作業はロジックを持たないため、ランタイムのデータフロー変更はない。ビルドフローのみ:

```
1. manifest.ts を編集
2. pnpm build → make-manifest-plugin が dist/manifest.json を生成
3. dist/manifest.json の内容を検証（権限・エントリ）
4. Chrome に dist/ を読み込み、警告表示とポップアップ/オプションの起動を確認
```

## エラーハンドリング戦略

- ランタイムのエラー処理は対象外。ビルド/型エラーが出た場合は原因（型不一致・キー名誤り）を特定して修正する。

## テスト戦略

### ユニットテスト
- 対象外。manifest は設定であり純粋ロジックを持たない。テスト基盤自体も未整備（U2 で導入）。

### 検証（手動・ビルド）
- `pnpm type-check` / `pnpm lint` / `pnpm build` の成功。
- `dist/manifest.json` の目視確認（`permissions` が4つ、`content_scripts`/`devtools_page` 不在、`commands` 存在）。
- Chrome への読み込みで、権限警告・ポップアップ起動・オプション起動を確認。

## 依存ライブラリ

新規追加なし。

## ディレクトリ構造

```
chrome-extension/
└── manifest.ts        # 変更（権限・エントリ・commands）
.gitignore             # 変更（.steering の扱い次第・保留）
```

## 実装の順序

1. `manifest.ts` の `permissions` を4権限へ更新
2. `content_scripts` ブロックを削除
3. `devtools_page` を削除
4. `web_accessible_resources` を削除（破綻時は最小パターンへ縮小）
5. `commands._execute_action` を追加
6. `action.default_popup` / `options_page` を確認
7. `pnpm type-check` → `pnpm lint` → `pnpm build` で検証
8. `dist/manifest.json` と Chrome 読み込みで受け入れ条件を確認

## セキュリティ考慮事項

- 本作業自体が「最小権限・host permission 不要・露出面最小化」というセキュリティ是正である。
- 変更後に `permissions` が意図した4つに収まっているか、`host_permissions` や広範な `web_accessible_resources` が復活していないかを必ず確認する。

## パフォーマンス考慮事項

- 特になし（設定変更のみ）。不要な `content_scripts` を除去することで、全ページへのスクリプト注入がなくなる副次的な軽量化はある。

## 将来の拡張性

- Firefox 対応（Post-MVP）に備え `browser_specific_settings` は保持する。
- カスタムショートカット（`_execute_action` 以外）が必要になった場合は `commands` に追加し、受信処理を Service Worker（U17）側で実装する。
