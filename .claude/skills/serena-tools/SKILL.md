---
name: serena-tools
description: ファイルの検索・読み書き・編集を行う際に、serena MCPのシンボルベースのツール群を優先的に採用するためのガイド。コード調査時、コード実装・編集時、リファクタリング時に読み込む。
allowed-tools: mcp__serena__get_symbols_overview, mcp__serena__find_symbol, mcp__serena__find_referencing_symbols, mcp__serena__search_for_pattern, mcp__serena__find_file, mcp__serena__list_dir, mcp__serena__read_file, mcp__serena__replace_symbol_body, mcp__serena__insert_after_symbol, mcp__serena__insert_before_symbol, mcp__serena__replace_content, mcp__serena__rename_symbol, mcp__serena__create_text_file, mcp__serena__find_implementations, mcp__serena__find_declaration, mcp__serena__safe_delete_symbol, mcp__serena__get_diagnostics_for_file, mcp__serena__initial_instructions
---

# Serena ツール活用スキル

ファイルの検索・読み込み・書き込み・編集を行う際に、**serena MCP のシンボルベースのツール群を最優先で採用する**ためのスキルです。

serena は LSP（Language Server Protocol）を背景に持ち、関数・クラスなどの **シンボル単位** での検索・参照追跡・リネーム・編集に対応しています。ファイル全体を読み込む／文字列を逐一指定するのではなく、必要なシンボルだけを賢く取得・編集することで、正確かつ低コストに作業できます。

## 🚨 最重要原則

**MUST（必須）**:
- コード調査・編集タスクの開始時に、まだ `initial_instructions` を読んでいなければ `mcp__serena__initial_instructions` を呼んで Serena の使い方を確認する
- ファイル検索・コード調査では、組み込みの Grep / Glob / Read より **serena のツールを優先**する
- コード編集では、組み込みの Edit / Write より **serena のシンボル編集・`replace_content` を優先**する
- ファイル全体を読む前に、まず `get_symbols_overview` で構造を把握し、**必要なシンボルの body だけ**を読む

**NEVER（禁止）**:
- 把握済みの構造があるのに、漫然とファイル全体を `read_file` する
- シンボル単位で置換できる変更なのに、巨大な文字列を手で全コピーして編集する
- 参照の更新が必要なリネームを、手動の文字列置換だけで済ませる（`rename_symbol` を使う）

> ⚠️ **serena の行番号は 0-based** です。組み込みツール（1-based）と混同しないこと。
> ⚠️ パスは **プロジェクトルートからの相対パス** で指定します（絶対パスではない）。

## いつこのスキルを使うか

| シーン | 主に使うツール |
| --- | --- |
| コード調査・全体把握 | `get_symbols_overview` → `find_symbol` |
| シンボル名・場所が曖昧 | `search_for_pattern` → `find_symbol` |
| 影響範囲の調査 | `find_referencing_symbols`, `find_implementations`, `find_declaration` |
| ファイル/ディレクトリ探索 | `find_file`, `list_dir` |
| シンボル全体の書き換え | `replace_symbol_body` |
| シンボルの追加 | `insert_after_symbol`, `insert_before_symbol` |
| 数行の部分編集 | `replace_content`（regex 推奨） |
| 名称変更（参照も追従） | `rename_symbol` |
| シンボルの安全な削除 | `safe_delete_symbol` |
| 新規ファイル作成 | `create_text_file` |
| 編集後の検証 | `get_diagnostics_for_file` |

## ツールマッピング: 組み込み → serena

| やりたいこと | 組み込み（避ける） | serena（優先） |
| --- | --- | --- |
| ファイル名で探す | Glob | `find_file` |
| 文字列/正規表現で探す | Grep | `search_for_pattern` |
| 関数/クラス定義を探す | Grep | `find_symbol` |
| ディレクトリ一覧 | Bash `ls` | `list_dir` |
| ファイルを読む | Read | `read_file`（ただし下記「読む前に構造把握」を優先） |
| 数行の編集 | Edit | `replace_content` |
| 関数/クラス全体の置換 | Edit | `replace_symbol_body` |
| 新規ファイル作成 | Write | `create_text_file` |
| リネーム | 手動 Edit 複数回 | `rename_symbol` |

## 調査のワークフロー（読む前に構造把握）

1. **ディレクトリ/ファイルの場所を把握**
   - `list_dir(relative_path, recursive)` でツリーを確認
   - `find_file(file_mask, relative_path)` でファイル名から探す（`*`, `?` ワイルドカード可）

2. **ファイルの構造を俯瞰**（いきなり全文を読まない）
   - `get_symbols_overview(relative_path)` で、そのファイルに含まれるシンボル（クラス・関数など）を一覧取得

3. **必要なシンボルだけ深掘り**
   - `find_symbol(name_path_pattern, relative_path, include_body=True)` で対象の body を取得
   - クラスの中身を一覧したいだけなら `depth=1, include_body=False` でメソッド一覧を取得し、必要なものだけ後から body を読む
   - `name_path` の指定:
     - 単純名 `"myMethod"` … 同名シンボルにマッチ
     - 相対パス `"MyClass/myMethod"` … 末尾一致
     - 絶対パス `"/MyClass/myMethod"` … ファイル内フルパス完全一致
   - `substring_matching=True` で末尾要素の部分一致が可能（`"Foo/get"` が `getValue` にマッチ）

4. **シンボル名/場所が曖昧なとき**
   - `search_for_pattern(substring_pattern, ...)` で候補を正規表現検索 → 見つけた名前で `find_symbol` に切り替える
   - `paths_include_glob` / `paths_exclude_glob` / `relative_path` で検索範囲を絞る
   - `restrict_search_to_code_files=True` で定義検索を効率化

5. **関係性・影響範囲を追跡**
   - `find_referencing_symbols(name_path, relative_path)` … そのシンボルを参照している箇所を取得（リネーム/シグネチャ変更前に必須）
   - `find_implementations(...)` … インターフェース/抽象の実装を探す
   - `find_declaration(...)` … 宣言元へジャンプ

> 💡 一度ファイル全体を `read_file` で読んだら、同じファイルに対して改めてシンボル読みを重ねる必要はありません。すでに情報を持っています。

## 編集のワークフロー

編集には2つのアプローチがあります。**変更の粒度で使い分ける**こと。

### (a) シンボル単位の編集

メソッド・クラス・関数など **シンボル全体** を対象にする場合に最適。

- **本体の書き換え**: `replace_symbol_body(name_path, relative_path, body)`
  - 🚨 事前に `include_body=True` で body を取得し、何が body を構成するかを把握してから使うこと
  - `body` には署名行（関数なら `def`/`function` 行など）を含める
- **末尾に追加**: `insert_after_symbol(name_path, relative_path, body)`
  - クラス/メソッド/関数定義の後ろに新しいコードを挿入。ファイル末尾への追加はファイル内最後のトップレベルシンボルを指定
- **先頭に挿入**: `insert_before_symbol(name_path, relative_path, body)`
  - ファイル先頭への import 追加などは、ファイル内最初のシンボルを指定
- **安全な削除**: `safe_delete_symbol(...)` … 参照を考慮した削除

### (b) ファイル内の部分編集

シンボル全体ではなく **数行だけ** を直すなら `replace_content` を使う。

- `replace_content(relative_path, needle, repl, mode)`
- `mode="regex"` を積極的に使う（Python `re`、DOTALL/MULTILINE 有効）
  - 🚀 `"先頭.*?置換したい末尾"` の形のワイルドカードで、長い区間を全文引用せずに置換できる（高速・低コスト）
  - 後方参照は `$!1`, `$!2` … の構文
- 複数箇所を一括置換したいときは `allow_multiple_occurrences=True`。デフォルトは単一一致で、複数マッチ時はエラーになるので正規表現を見直して再試行できる

### リネーム（参照も追従させる）

- `rename_symbol(name_path, relative_path, new_name)` … コードベース全体で参照ごとリネーム
- 手動の文字列置換でリネームしない（参照漏れの原因）

### 新規ファイル

- `create_text_file(relative_path, content)` で作成（既存があれば上書き）

### 編集後の検証

- 編集が静的エラーを生んでいないか `get_diagnostics_for_file(relative_path)` で確認する

## 効率の原則

- **必要なものだけ読む**: タスクに不要なコードは読まない・生成しない
- **俯瞰 → 深掘り**: `get_symbols_overview` / `depth` で構造を掴んでから body を読む
- **範囲を絞る**: `relative_path` や glob を渡して検索を限定する
- **シンボル編集ツールは信頼できる**: エラーなく返れば結果検証は基本不要（必要なら `get_diagnostics_for_file`）

## このスキルでカバーしないもの

- serena のシンボルツールは **コード（解析可能な言語）に最も効果的**です。Markdown など非コードのプレーンテキストは `read_file` / `create_text_file` / `replace_content` を使い、組み込みツールとも適宜併用してください。
- ビルド・テスト・git などのシェル実行は通常の Bash ツールを使います（`mcp__serena__execute_shell_command` も利用可だが、本スキルの対象外）。

## チェックリスト

調査時:
- [ ] 開始時に `initial_instructions` を確認したか
- [ ] いきなり全文 Read していないか（`get_symbols_overview` から始めたか）
- [ ] 検索は Grep/Glob でなく `search_for_pattern`/`find_symbol`/`find_file` を使ったか
- [ ] 影響範囲を `find_referencing_symbols` 等で確認したか

編集時:
- [ ] シンボル全体の変更に `replace_symbol_body`/`insert_*` を使ったか
- [ ] 部分編集に `replace_content`（regex）を使ったか
- [ ] リネームは `rename_symbol` で参照ごと更新したか
- [ ] `replace_symbol_body` の前に body を取得済みか
- [ ] 編集後に `get_diagnostics_for_file` で検証したか
