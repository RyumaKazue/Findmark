# 設計書 — U18 release-prep

## アーキテクチャ概要

本単位は既存のレイヤー構成（UI → サービス → データ）を変えない。追加するのは **文言解決の横断レイヤー**と、**提出物（メタデータ / ドキュメント / 画像アセット）** である。

```mermaid
graph TD
  subgraph データ層
    SS[SettingsStore<br/>UserSettings.locale]
  end
  subgraph 文言レイヤー（新規）
    CAT[locales/ja,en/messages.json<br/>カタログ＝_localesの正]
    CORE["packages/i18n<br/>resolveUiLocale / createTranslator<br/>(React非依存)"]
    PROV["packages/i18n/react<br/>I18nProvider / useI18n"]
    CAT --> CORE --> PROV
  end
  subgraph UI層
    POP[Popup ツリー]
    OPT[Options ツリー]
    MODEL["純粋モデル関数<br/>(キー+置換値を返す)"]
  end
  SS -->|locale| PROV
  PROV -->|t| POP
  PROV -->|t| OPT
  MODEL -->|{key, substitutions}| POP
  CAT -->|ビルド時コピー| DIST["dist/_locales<br/>(manifest の __MSG_*)"]
```

**2系統の文言解決を明確に分離する**:

| 用途 | 解決方法 | 反映されるロケール |
|---|---|---|
| manifest の `name` / `description` / コマンド説明 | `_locales` + `__MSG_*`（Chrome が解決） | ブラウザUI言語（`default_locale: ja` にフォールバック） |
| Popup / Options のUI文言 | バンドル済みカタログ + `createTranslator` | `UserSettings.locale` → 未設定なら `chrome.i18n.getUILanguage()` |

`chrome.i18n.getMessage` はブラウザUI言語しか参照できず、アプリ内の言語切替を実現できない。一方 manifest 文言は `_locales` でしか国際化できない。**同一のカタログファイルを両系統の入力にする**ことで二重管理を避ける（`prepare-build.ts` が `locales/` を `dist/_locales/` へコピーする既存挙動をそのまま利用する）。

## コンポーネント設計

### 1. `packages/i18n` — 翻訳コア（React 非依存）

**責務**:
- ロケール解決（設定値 > ブラウザUI言語 > 既定 `ja`）
- メッセージキーの展開（`$1` 位置置換 / `$NAME$` プレースホルダ置換）
- 欠落キーのフォールバック

**実装の要点**:
- 追加ファイル: `lib/runtime.ts`（`UI_LOCALES` / `resolveUiLocale` / `createTranslator` / `CATALOGS`）、`lib/react.tsx`（`I18nProvider` / `useI18n`）。
- カタログは `import ja from '../locales/ja/messages.json' with { type: 'json' }` の静的 import。`tsc` は `resolveJsonModule` により import された JSON を `dist/locales/**` へ出力するため、既存ビルド構成のまま解決できる（現状 en のみ出力されているのはこの仕組みによる）。
- 既存 `t`（`i18n-dev.ts` / `i18n-prod.ts`）は `packages/ui` の `ErrorDisplay` が使用中のため**残す**。本単位では削除しない。
- 型: `MessageKey = keyof typeof jaCatalog`。ja を型の正とし、en の欠落はテストで検出する（`ja` が既定ロケールのため）。
- `createTranslator(locale)` は `(key: MessageKey, substitutions?: string | string[]) => string`。
  - 該当ロケールにキーがなければ `ja` を引き、それも無ければ `key` 文字列自体を返す（**例外を投げない** = 文言不足でUIを壊さない）。
  - 置換順序は既存 `i18n-dev.ts` に合わせる（`placeholders` の `content` 展開 → `$1..$n` を `substitutions` で置換）。
- React 連携（`lib/react.tsx`）:
  - `I18nProvider({ locale, children })` が `createTranslator(locale)` を `useMemo` でメモ化してコンテキストに載せる。
  - `useI18n()` は `{ t, locale }` を返す。Provider 外で呼ばれた場合は既定ロケール(ja)の translator を返し、クラッシュさせない。
  - `react` は `peerDependencies` + `devDependencies` に追加（`packages/ui` と同じ扱い）。

**キー命名規約**:

| 接頭辞 | 対象 | 例 |
|---|---|---|
| `extension*` | manifest（既存） | `extensionName` / `extensionDescription` |
| `command*` | manifest の commands | `commandOpenPopup` |
| `common*` | Popup / Options 共通 | `commonCancel` / `commonDelete` / `commonLoading` |
| `popup*` | Popup 固有 | `popupSearchPlaceholder` / `popupMetaScopedQuery` |
| `options*` | Options 固有 | `optionsTabTrash` / `optionsShortcutUnassignedTitle` |
| `displayError*` | `packages/ui` の ErrorDisplay（既存・維持） | `displayErrorInfo` |

### 2. ロケールの供給（Popup / Options のルート）

**責務**: `SettingsStore` から `locale` を読み、`I18nProvider` に供給する。

**実装の要点**:
- ルート（`Popup.tsx` / `Options.tsx`）でのみ `settingsStore.get()` を呼び、`locale` state を持つ。**UI から chrome API を直接叩かない**既存規律（UI → サービス → データ）を維持する。
- 初期表示は `resolveUiLocale(undefined)`（ブラウザUI言語ベース）で描画し、設定読み込み後に確定値へ差し替える。**PRD の「起動→検索フォーカス 200ms 以内」を守るため、設定読み込みを描画のブロッキング条件にしない**（U19 で既定値を先に適用したのと同じ方針）。
- Options の言語変更は `SettingsTab` からルートへ通知（コールバック props）し、即時に `I18nProvider` の `locale` を更新する = 再読み込みなしで切り替わる。
- Popup は起動時に設定を読むだけ（切替UIを持たない）。

### 3. 純粋モデル関数の文言分離

**責務**: 表示文字列ではなく**メッセージキーと置換値**を返す。

**実装の要点**:
- 共通の戻り値型を `pages/popup/src/lib/message.ts` に定義する:
  ```ts
  interface LocalizedMessage { key: MessageKey; substitutions?: string[] }
  ```
- 対象と変更内容:

| 対象 | 変更前 | 変更後 |
|---|---|---|
| `resultMetaModel.buildResultMetaLabel` | `'すべて の中から「docs」— 4件'` | `{ key: 'popupMetaScopedQuery', substitutions: [scopeLabel, query, '4'] }`（メタ行なしは `null` のまま） |
| `inlineEditModel.validateUrl` | `{ ok:false, message: 'URLを入力してください' }` | `{ ok:false, message: { key: 'popupErrorUrlRequired' } }` |
| その他モデル（`folderTreeModel.formatPath` 等） | 記号連結のみ | 変更なし（ロケール非依存） |

- 「すべて」のようなスコープ表示名は UI 層で翻訳して渡す（モデルは受け取った文字列をそのまま組み立てる）。
- 既存ユニットテストは**キーと置換値の検証**へ更新する。テストは日本語文言に依存しなくなり、文言変更で壊れなくなる。

### 4. アイコン生成

**責務**: Findmark 固有アイコンを再現可能な形で生成する。

**実装の要点**:
- 生成元: `chrome-extension/public/icon.svg`（`docs/design/` のアクセントカラーを使用したブックマーク + 検索のモチーフ）。
- 生成スクリプト: `bash-scripts/generate_icons.mjs`。ローカルの Chrome を `--headless --screenshot --window-size=N,N --default-background-color=00000000` で起動し、SVG を各サイズの PNG へ書き出す（**外部ネットワーク・追加 npm 依存なし**）。
- 出力: `chrome-extension/public/icon-16.png` / `icon-32.png` / `icon-48.png` / `icon-128.png`。ボイラープレートの `icon-34.png` は削除する。
- 生成物は Git 管理下に置く（CI に Chrome を要求しないため）。スクリプトは再生成用に残す。
- Chrome が見つからない場合はスクリプトが明示エラーで停止する（パスは環境変数 `CHROME_BIN` で上書き可能）。

### 5. manifest / パッケージメタ

| 項目 | 変更 | 根拠 |
|---|---|---|
| `icons` | `16/32/48/128` を登録 | ストア要件・各所での表示 |
| `action.default_icon` | `16/32/48/128` のマップに変更 | ツールバー表示の解像度対応 |
| `browser_specific_settings` | 削除 | MVP は Chrome 専用（mvp-development-flow スコープ外） |
| `commands._execute_action.description` | `__MSG_commandOpenPopup__` | i18n 化 |
| ルート `package.json` | `name: 'findmark'` / `description` / `version: '1.0.0'` / `repository` を是正 | manifest の `version` は `packageJson.version` を参照するため、ストア初回提出版 `1.0.0` になる |

- `default_locale: 'ja'` と `permissions`（4つ）は**変更しない**（PRD の最小権限方針）。

### 6. 提出 zip のクリーンアップ

**責務**: 提出物に manifest 未宣言のコードを含めない。

**実装の要点**:
- 削除対象: `pages/devtools/` / `pages/devtools-panel/` / `pages/content-runtime/`、対応 e2e spec（`page-devtools-panel.test.ts` / `page-content-runtime.test.ts`）、未使用の `chrome-extension/public/content.css`。
- `pnpm-workspace.yaml` は `pages/*` グロブのため設定変更は不要。削除後に `pnpm install` の整合性と `pnpm build` を確認する。
- 削除により未使用となるカタログキー（`toggleTheme` / `injectButton` / `greeting` / `hello`）も同時に削除する。
- **`packages/ui` の `ErrorDisplay` は Popup / Options が使用中**のため、`displayError*` キーと `packages/ui` は残す。

### 7. ストア提出ドキュメント（`docs/store/`）

| ファイル | 内容 |
|---|---|
| `README.md` | 提出チェックリスト（完了済み / 人手が必要 を区別）、`favicon` 権限の警告有無の確認結果と根拠、外部通信ゼロの静的確認結果 |
| `listing-ja.md` / `listing-en.md` | 拡張名 / 短い説明(132字以内) / 詳細説明 / カテゴリ / 権限 justification / 起動ショートカット未割り当ての注意 |
| `privacy-policy-ja.md` / `privacy-policy-en.md` | 収集データなしの宣言、保存先(`chrome.storage` sync/local)、第三者提供なし、host permission なし、連絡先 |
| `screenshots.md` | 1280×800 の5シナリオ（1a 通常 / 1c 別名ヒット / 1d インライン編集 / 1f 複数選択 / Options）と撮影手順・前準備（サンプルブックマーク） |

- 権限 justification は manifest の `permissions` と1対1で対応させ、`docs/architecture.md` の「セキュリティ制約」と矛盾しない表現にする。
- `favicon` 権限の警告有無は **Chrome 公式ドキュメントの記載を根拠として記録**し、実機での最終確認手順を `README.md` のチェックリストに残す。

## データフロー

### UI 文言の解決（Options で言語を切り替える）
```
1. Options ルートがマウント → resolveUiLocale(undefined) で暫定ロケール決定 → I18nProvider に供給
2. settingsStore.get() 解決 → locale='en' → setLocale('en') → Provider が translator を再生成
3. 全子コンポーネントが useI18n().t で再描画（英語表示）
4. ユーザーが「表示言語」を ja に変更 → SettingsTab が settingsStore.setLocale('ja') を await
5. 保存成功後に onLocaleChange('ja') でルートへ通知 → Provider 更新 → 即時に日本語表示
6. 次回 Popup 起動時、settingsStore.get() が 'ja' を返し日本語で表示
```

### メッセージキーの表示（メタ行）
```
1. Popup が buildResultMetaLabel({ scopePath, query, count }) を呼ぶ
2. モデルが { key: 'popupMetaScopedQuery', substitutions: ['開発 / chrome', 'docs', '4'] } を返す（null ならメタ行なし）
3. UI が t(key, substitutions) で文字列化して描画
```

### アイコン生成
```
1. bash-scripts/generate_icons.mjs を実行
2. chrome-extension/public/icon.svg を各サイズの HTML ラッパへ埋め込み
3. headless Chrome の --screenshot で PNG を書き出し（背景透過）
4. chrome-extension/public/icon-{16,32,48,128}.png を更新（生成物はコミット）
```

## エラーハンドリング戦略

### カスタムエラークラス
新規のエラークラスは追加しない。

### エラーハンドリングパターン

| 事象 | 方針 |
|---|---|
| メッセージキーが該当ロケールに無い | 既定ロケール(ja) → キー文字列 の順にフォールバック。例外は投げない |
| `settingsStore.get()` 失敗 | `console.error` の上、ブラウザUI言語ベースの既定ロケールで継続（UI は必ず描画される） |
| `chrome.i18n.getUILanguage()` が利用不可 | `try/catch` で握り潰し `ja` を採用 |
| ロケール保存失敗（Options） | 既存の `SettingsTab` のエラー表示を踏襲。保存に失敗した場合は Provider の locale を更新しない（表示と保存値の不一致を防ぐ） |
| アイコン生成で Chrome が見つからない | スクリプトが非ゼロ終了し、`CHROME_BIN` の指定方法を案内（ビルド本体には影響しない） |

## テスト戦略

### ユニットテスト
- `packages/i18n`（vitest を新規導入）
  - `resolveUiLocale`: 設定値優先 / `ja-JP` → `ja` / `en-US` → `en` / 未知の言語 → `en` / 例外時 → `ja`
  - `createTranslator`: 位置置換 `$1` / `placeholders` 展開 / 欠落キーの ja フォールバック / ja にも無い場合のキー返却
  - **カタログ整合**: `ja` と `en` のキー集合が完全一致すること（欠落を機械的に検出）
- `pages/popup`（既存テストの更新）
  - `resultMetaModel`: 返り値がキー + 置換値であること（4パターン）
  - `inlineEditModel`: 検証 NG 時にメッセージキーを返すこと
- 既存の全モデルテストが引き続きパスすること

### 統合テスト
- `pnpm build` 成功と `dist/_locales/{ja,en}/messages.json` の存在確認
- `pnpm zip` 成功と、生成 zip に `devtools/` `devtools-panel/` `content-runtime/` が含まれないことの確認
- 既存 e2e spec（popup / options / smoke）が対象ページの削除後も構成として成立すること

### 手動確認（リリース実務）
- 実機で拡張をロードし、`favicon` 権限の警告表示有無を確認する
- 1280×800 スクリーンショットの撮影（`docs/store/screenshots.md` の手順に従う）

## 参照

- [docs/mvp-development-flow.md](../../docs/mvp-development-flow.md) — U18 の対象領域（`packages/i18n/`, `chrome-extension/public/`, ストア素材）
- [docs/repository-structure.md](../../docs/repository-structure.md) — `packages/i18n`（`_locales`(ja/en)の型付き参照）、`packages/zipper`（ストア提出用zip生成）
- [docs/architecture.md](../../docs/architecture.md) — 外部通信ゼロ / 最小権限
- [.steering/20260814-service-worker/](../20260814-service-worker/) — U17（ショートカット案内文の実装元）
