---
description: docs/ideas/initial-requirements.md からテンプレートの拡張機能情報(アプリ名・説明・default_locale)を更新する。manifest を必ず更新する。
---

# テンプレート情報の更新 (initial-requirements → manifest / i18n)

このコマンドは、`docs/ideas/initial-requirements.md` の内容を **正** として、
Chrome拡張ボイラープレートに元から入っているテンプレート情報を、
実際のプロダクトの情報へ書き換えます。

更新する項目は次の3つです。

| 項目 | 反映先 |
|---|---|
| **アプリ名** | `packages/i18n/locales/<default_locale>/messages.json` の `extensionName.message`(manifest が `__MSG_extensionName__` を参照するため) |
| **説明** | `packages/i18n/locales/<default_locale>/messages.json` の `extensionDescription.message`(manifest が `__MSG_extensionDescription__` を参照するため) |
| **default_locale** | `chrome-extension/manifest.ts` の `default_locale` |

さらに、このプロダクトの構成に合わせて **manifest のスリム化** を行います。

| 変更 | 内容 |
|---|---|
| **権限を `storage` のみに** | `permissions` を `['storage']` に絞る(`scripting` / `tabs` / `notifications` / `sidePanel` を削除) |
| **`side_panel` を削除** | manifest から `side_panel` を除去し、関与ファイル(`pages/side-panel/` 等)も削除 |
| **`content_scripts` を削除(CSS は残す)** | manifest の `content_scripts` から **JS エントリのみ**除去し、関与ファイル(`pages/content/`・`pages/content-ui/` 等)も削除。**CSS エントリ `{ css: ['content.css'] }` と `chrome-extension/public/content.css` は残す** |
| **`chrome_url_overrides` を削除** | manifest から `chrome_url_overrides` を除去し、関与ファイル(`pages/new-tab/` 等)も削除 |

**重要:** `chrome-extension/manifest.ts` は必ず更新すること(最低でも `default_locale`)。
manifest の `name` / `description` が `__MSG_...__` プレースホルダの場合、実体は i18n の
`messages.json` にあるため、そちらを書き換えることで「アプリ名・説明」の更新とする。
manifest に直接リテラル文字列が入っている場合は manifest 側も直接書き換える。

---

## このボイラープレートの構造(前提知識)

- `chrome-extension/manifest.ts`
  - `default_locale: 'en'`
  - `name: '__MSG_extensionName__'`(i18n 参照)
  - `description: '__MSG_extensionDescription__'`(i18n 参照)
- `packages/i18n/locales/<locale>/messages.json`
  - `extensionName.message` … 実際のアプリ名
  - `extensionDescription.message` … 実際の説明文
- `packages/i18n/lib/consts.ts` の `SUPPORTED_LANGUAGES` … 使用可能なロケールキー一覧
- **制約:** `default_locale` に指定するロケールは `packages/i18n/locales/<locale>/` が
  **必ず存在しなければならない**(無いとビルドが `en` にフォールバックし、指定が無効になる)。
- **モジュール管理ツール:** このボイラープレートには機能単位で追加・削除できる
  `module-manager` が同梱されている。ルートで次を実行できる。
  ```bash
  pnpm module-manager -d <feature> [<feature> ...]
  ```
  - `-d` はマニフェストの該当セクションを除去し、対応する `pages/<feature>/` フォルダと
    e2e スペックを **アーカイブして削除**する(`-r` で復元可能な非破壊的操作)。
  - 機能キーと manifest セクションの対応:
    | feature キー | 消える manifest セクション | 削除される主なファイル |
    |---|---|---|
    | `content` | `content_scripts` の JS エントリ(の一部) | `pages/content/` |
    | `content-ui` | `content_scripts` の JS エントリ(の一部) | `pages/content-ui/` |
    | `new-tab` | `chrome_url_overrides` | `pages/new-tab/` |
    | `side-panel` | `side_panel` + `sidePanel` 権限 | `pages/side-panel/` |
  - **補足:** `content_scripts` の CSS エントリ `{ css: ['content.css'] }` はどのモジュール定義にも
    含まれないため、`module-manager` では消えず**残る**。本コマンドではこの CSS を**意図的に残す**。
    `content.css` の実体は `chrome-extension/public/content.css`(`pages/content/` とは独立)。

---

## 手順

**このコマンドは可能な限り自動で最後まで実行する。判断が必要な箇所のみユーザーに確認する。**

### ステップ-1: 実行前チェックポイント(ロールバック用・必須)

このコマンドはファイルの**削除・編集・新規作成**を伴うため、失敗時に確実に戻せるよう、
**変更を始める前に**必ずチェックポイントを作成する。

1. git リポジトリであることを確認する(`git rev-parse --is-inside-work-tree`)。
   - git 管理外の場合は、対象ディレクトリを退避コピー(例: `tar` で `/tmp` にバックアップ)してから進む。
2. 未コミットの変更・未追跡ファイル(`.claude/` や `docs/` を含む)も含めてチェックポイント化する。
   ```bash
   git add -A
   git commit -m "checkpoint: before /update-template" || echo "変更なし: 現在の HEAD をチェックポイントとする"
   ```
   - **作業ツリーが既にクリーンな場合、`git commit` は `nothing to commit`(exit 1)で終わるが、これはエラーではない。**
     その場合は新規コミットを作らず、**現在の HEAD をそのままチェックポイントとして使う**(処理を止めない)。
   - `.claude/` と `docs/` も追跡下に入れておくことで、後述の `git clean` がそれらを消さず、
     コマンドが新規作成した未追跡ファイルだけを安全に除去できる。
   - チェックポイントのコミットハッシュを必ず控える(`git rev-parse HEAD`)。ロールバックで使う。
3. ユーザーに「チェックポイントを作成した。失敗時は下記手順で戻せる」と伝える。

**ロールバック手順(失敗した / 元に戻したい場合):**
```bash
git reset --hard <checkpoint-hash>   # 直後なら HEAD@{1} でも可
git clean -fd                        # 新規作成された未追跡ファイル(archive/*.zip, locales/<locale> 等)を除去
```
- module-manager で消した機能だけなら `pnpm module-manager -r` でも個別復元できる(補助手段)。

**成功してチェックポイントが不要になった場合:**
```bash
git reset --soft <checkpoint-hash>   # チェックポイントのコミットだけ解除し、変更内容は残す
```

### ステップ0: インプットの読み込み

1. `docs/ideas/initial-requirements.md` を読む。
   - 存在しない場合は処理を中止し、「`docs/ideas/initial-requirements.md` が見つかりません」と伝える。
2. 現在のテンプレート状態を把握するため、以下を読む。
   - `chrome-extension/manifest.ts`
   - `packages/i18n/locales/` 配下の各 `messages.json`
   - `packages/i18n/lib/consts.ts`(`SUPPORTED_LANGUAGES` の確認)

### ステップ1: 3つの値の決定

`initial-requirements.md` の内容から次を決定する。

1. **アプリ名**
   - ドキュメントのタイトル/コンセプトから、拡張機能名として自然な短い名前を決める。
   - 例(ブックマーク検索拡張): `ブックマーク検索` や `Alias Bookmark Search` など。
   - **ドキュメントからアプリ名を読み取れない場合は、ステップ1.5(ユーザー入力)へ進む。**
2. **説明**
   - コンセプト章(例: 第1章)を 1〜2文の簡潔なストア説明文に要約する。
   - Chrome Web Store の説明は 132 文字以内が推奨のため、長すぎる場合は要約する。
   - **ドキュメントから説明を読み取れない場合は、ステップ1.5(ユーザー入力)へ進む。**
3. **default_locale**
   - ドキュメントの記述言語と主要ターゲットから判定する。
     - 日本語で書かれ、日本語話者向け → `ja`
     - 英語主体 → `en`
   - **必ず `SUPPORTED_LANGUAGES`(`consts.ts`)に存在するキーを使う。**
   - 決めた `default_locale` が既存判断に迷う/ドキュメントから読み取れない場合のみ、
     ユーザーに確認する(それ以外は自動で決めてよい)。

### ステップ1.5: 不足値のユーザー入力(アプリ名・説明が取得できない場合)

`initial-requirements.md` から **アプリ名 または 説明 が読み取れなかった場合のみ** 実行する。
両方ともドキュメントから取得できた場合は、このステップをスキップしてステップ2へ進む。

1. `AskUserQuestion` ツールで、不足している項目だけをユーザーに尋ねる。
   - アプリ名が不足 → 「拡張機能のアプリ名を入力してください」
   - 説明が不足 → 「拡張機能の説明文(ストア掲載用、132文字以内推奨)を入力してください」
   - 可能な範囲でドキュメントから推測した候補を選択肢として提示し、
     ユーザーが選ぶか、自由入力(Other)で確定できるようにする。
   - アプリ名・説明の両方が不足している場合は、2問まとめて尋ねてよい。
2. ユーザーが入力した値を、それぞれ確定値として採用する。
3. **ユーザーの入力が得られるまで、後続のファイル書き込み(ステップ2以降)へ進まないこと。**

決定した3つの値を、書き込み前にユーザーへ提示する。

```
以下の内容でテンプレートを更新します:
- アプリ名     : <name>
- 説明         : <description>
- default_locale: <locale>
```

### ステップ2: default_locale のロケールフォルダを用意

1. `packages/i18n/locales/<default_locale>/messages.json` が存在するか確認する。
2. **存在しない場合:**
   - `packages/i18n/locales/en/messages.json` を雛形として
     `packages/i18n/locales/<default_locale>/messages.json` を新規作成する。
   - `extensionName` / `extensionDescription` 以外のキーは、
     可能なら `<default_locale>` の言語へ翻訳する。翻訳が困難なキーは英語のまま残してよい。
   - JSON のキー構造(`description` / `message` / `placeholders` 等)は雛形どおり維持する。

### ステップ3: アプリ名・説明の反映(i18n)

1. `packages/i18n/locales/<default_locale>/messages.json` を編集する。
   - `extensionName.message` ← 決定したアプリ名
   - `extensionDescription.message` ← 決定した説明文
2. 他に既存のロケール(例: `en`, `ko`)がある場合は、
   同じ `extensionName` / `extensionDescription` を各言語へ翻訳して反映し、整合性を保つ。
   - 翻訳が不確実な言語は、少なくとも英語(`en`)の値で更新しておく。

### ステップ4: manifest の更新(必須)

1. `chrome-extension/manifest.ts` を編集する。
   - `default_locale` を決定した `<default_locale>` に変更する。
2. `name` / `description` の扱い:
   - `__MSG_extensionName__` / `__MSG_extensionDescription__` のプレースホルダのままなら、
     ステップ3の i18n 更新で反映済みのため manifest 側は変更不要(`default_locale` のみ変更)。
   - もしリテラル文字列が直接入っていた場合は、manifest 側も決定した値へ直接書き換える。

### ステップ4.5: 依存関係のインストール(pnpm install)

ステップ5 の `module-manager` 実行と、ステップ6 の型チェックには**ワークスペースの依存関係が必要**。
`node_modules` が未導入だとどちらも動かないため、ここで一度だけインストールする。

1. `node_modules` の有無を確認する(例: `packages/module-manager/node_modules` や
   ルートの `node_modules/.bin/tsc` が存在するか)。既に導入済みならこのステップはスキップしてよい。
2. ルートで依存を導入する(冪等。導入済みならほぼ即時に終わる)。
   ```bash
   pnpm install --frozen-lockfile
   ```
   - `--frozen-lockfile` は `pnpm-lock.yaml` を書き換えないため、変更差分を汚さない。
   - ロックファイル不整合などで失敗した場合のみ、`pnpm install`(frozen なし)で再試行する。
3. `node_modules` は `.gitignore` 対象のため、ステップ-1 のチェックポイント差分や
   ロールバック(`git clean -fd`)には影響しない(**`-x` を付けないこと**。付けると `node_modules` ごと消える)。
4. インストールに失敗し復旧できない場合のみ、ステップ5 は手動フォールバックで進め、
   ステップ6 は JSON 妥当性＋目視確認に切り替える(処理は止めない)。

### ステップ5: manifest のスリム化(不要機能の削除 + 権限の絞り込み)

このプロダクトでは使わない機能を manifest から取り除き、**関与ファイルも削除**する。

1. **不要機能の削除(manifest セクション + pages ファイル)**
   - 同梱の `module-manager` を使うのが最も安全(ステップ4.5 で依存導入済みのため通常はこのまま実行できる)。
     ルートで次を実行する。
     ```bash
     pnpm module-manager -d content content-ui new-tab side-panel
     ```
     - `content` / `content-ui` … `content_scripts` を除去し、`pages/content/`・`pages/content-ui/` を削除
     - `new-tab` … `chrome_url_overrides` を除去し、`pages/new-tab/` を削除
     - `side-panel` … `side_panel`(と `sidePanel` 権限)を除去し、`pages/side-panel/` を削除
   - `module-manager` が使えない環境では、手動で以下を行う。
     - `chrome-extension/manifest.ts` の `content_scripts` から **JS を持つエントリ**
       (`js: [...]` を含むもの)をすべて削除する。**CSS だけのエントリ
       `{ css: ['content.css'] }` は残す**(削除後、`content_scripts` は CSS エントリ 1 件だけになる)。
     - `chrome_url_overrides` / `side_panel` の各ブロックを削除する。
     - `pages/content/`・`pages/content-ui/`・`pages/new-tab/`・`pages/side-panel/` フォルダと、
       対応する `tests/e2e/specs/page-*.test.ts` を削除する。
     - **`chrome-extension/public/content.css` は削除しない**(CSS エントリが参照するため)。

2. **削除結果の確認(必須)**
   - `chrome-extension/manifest.ts` を再度開き、次を目視で確認する。
     - `content_scripts` が **CSS エントリ `{ css: ['content.css'] }` の 1 件だけ**残っていること
       (JS を含むエントリが 1 つも残っていないこと)。**この CSS エントリは消さない。**
     - `side_panel` / `chrome_url_overrides` のキーが残っていないこと。残っていれば手で削除する。
   - `chrome-extension/public/content.css` が残っていることを確認する。
   - `web_accessible_resources` が削除済み機能専用のリソースのみを参照していないかを確認し、
     不要なら整理する(`content.css` 関連は残す)。

3. **権限を `storage` のみに絞る**
   - `chrome-extension/manifest.ts` の `permissions` を `['storage']` に変更する
     (`scripting` / `tabs` / `notifications` / `sidePanel` を削除)。
   - `host_permissions`(`['<all_urls>']`)は content_scripts 削除により不要になるため、
     要件で host permission 不要とされている場合は合わせて削除する。判断に迷う場合のみ確認する。

### ステップ6: 検証

1. **先に生成ステップ `ready` を実行する。**
   i18n の `lib/i18n.ts` はビルド時生成ファイルで、これが無いと型チェックが
   `Cannot find module './i18n.js'` で必ず失敗する。turbo の `type-check` タスクは
   `ready` に依存していないため、明示的に生成を走らせる(依存順に env→i18n 等をビルドする)。
   ```bash
   pnpm exec turbo run ready
   ```
2. 本コマンドで**変更したパッケージ**を型チェックする。
   ```bash
   pnpm -F chrome-extension type-check
   pnpm -F @extension/i18n type-check
   ```
   - この2つが**エラーなしで通ればよい**。`popup` / `@extension/ui` など**変更対象外**の
     パッケージに既存の型エラーが出ることがあるが、本コマンドの成否とは切り離して扱う
     (`pnpm type-check` で全体を回すと既存エラーに埋もれるため、変更パッケージを個別に確認する)。
   - ステップ4.5 のインストールに失敗した等で**どうしても実行できない環境**に限り、
     JSON の妥当性(パース可能か)と `manifest.ts` の TypeScript 構文が壊れていないことを目視で確認する。
3. `default_locale` に指定したロケールの `messages.json` が実在することを再確認する
   (フォールバックで無効化されないため)。

### ステップ7: 完了報告

変更内容をまとめて報告する。

```
テンプレート情報を更新しました。

- アプリ名      : <name>
- 説明          : <description>
- default_locale: <locale>
- 権限          : ['storage']

変更したファイル:
✅ chrome-extension/manifest.ts (default_locale / permissions / side_panel・chrome_url_overrides を削除 / content_scripts は CSS エントリのみ残す)
✅ packages/i18n/locales/<locale>/messages.json (extensionName / extensionDescription)
（必要に応じて）✅ 他ロケールの messages.json を同期

削除したファイル:
🗑 pages/content/ , pages/content-ui/ (content_scripts の JS)
🗑 pages/new-tab/ (chrome_url_overrides)
🗑 pages/side-panel/ (side_panel)
🗑 対応する tests/e2e/specs/page-*.test.ts

残したファイル:
📌 chrome-extension/public/content.css と content_scripts の CSS エントリ { css: ['content.css'] }
```

---

## 注意事項

- **manifest の更新は必須。** 最低でも `default_locale` を必ず書き換えること。
- `default_locale` は `SUPPORTED_LANGUAGES` に含まれるキーのみ使用可。
- `default_locale` のロケールフォルダが無ければ**先に作成**してから default を切り替える
  (順序を誤ると一時的にビルドが壊れる)。
- アプリ名・説明の実体は i18n の `messages.json` にあるため、
  manifest の `__MSG_...__` を直接編集しないこと(参照が壊れる)。
- **権限は `storage` のみ**にする。`scripting` / `tabs` / `notifications` / `sidePanel` を残さない。
- 機能削除は `module-manager -d` を優先(manifest とファイルを一括処理し、`-r` で復元可能)。
- **`content_scripts` の CSS エントリ `{ css: ['content.css'] }` と
  `chrome-extension/public/content.css` は残す。**削除するのは JS ベースの content_scripts
  (`content` / `content-ui`)とその `pages/` ファイルのみ。削除後に CSS エントリが
  残っていることを必ず目視確認する。
- バージョン番号(`version`)は `package.json` から供給されるため、このコマンドでは変更しない。
