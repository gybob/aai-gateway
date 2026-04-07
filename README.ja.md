[English](README.md) | [简体中文](README.zh-CN.md) | 日本語 | [한국어](README.ko.md)

---

# AAI Gateway：MCP ツールと Skill を統一管理、AI Agent 間で共有、コンテキストトークン 99% 削減

[![npm version](https://img.shields.io/npm/v/aai-gateway)](https://www.npmjs.com/package/aai-gateway)
[![license](https://img.shields.io/npm/l/aai-gateway)](./LICENSE)

---

## 何ですか

**AAI** = **Agent App Interface**

AAI Gateway は Agent App のインタラクションゲートウェイです。

**Agent App** とは？Agent App は Agent が使用できる能力の集合です。例えば：

- **MCP Server** は一つの Agent App —— ツールのセットを提供
- **Skill パッケージ** も一つの Agent App —— 一つまたは複数のスキルを提供

AAI Gateway では、これらを **Agent App** として統一管理します。一度インポートすれば、すべての AI Agent ですぐに使えます。

---

## 解決する問題

### コンテキスト膨張

従来の方法：10 MCP × 5 ツール = **50 の完全な schema ≈ 7,500 トークン**、毎回の会話に注入。

AAI Gateway：各 Agent App は**50 トークン未満のサマリー**だけで、詳細は必要に応じてロード。**トークン 99% 削減。**

### ツール探しが面倒

従来の方法：GitHub を探す → README を読む → JSON 設定をコピー → 接続をデバッグ → Agent を再起動。

AAI Gateway：**一言で Agent が自動検索・インストール・即利用可能**。

> 「会社紹介の PPT を作りたい」
>
> → Agent が PPT スキル不足を検出 → 自動検索して PPT Skill をインストール → 作成をガイド、再起動不要

> 「このウェブページの内容を取得して」
>
> → Agent がウェブスクレイピングツール不足を検出 → 対応する MCP を自動検索・インストール → 直接取得、再起動不要

### 重複設定

Claude Code、Codex、OpenCode で個別に設定？AAI Gateway で一度インポートすれば、すべての Agent で即座に共有。

---

## クイックスタート（30 秒）

**Claude Code：**

```bash
claude mcp add --scope user --transport stdio aai-gateway -- npx -y aai-gateway
```

**Codex：**

```bash
codex mcp add aai-gateway -- npx -y aai-gateway
```

**OpenCode** — `~/.config/opencode/opencode.json` に追加：

```json
{
  "mcp": {
    "aai-gateway": {
      "type": "local",
      "command": ["npx", "-y", "aai-gateway"],
      "enabled": true
    }
  }
}
```

インストール後、Agent にやりたいことを伝えるだけです。

---

## 組み込みツール

| ツール | 説明 |
|--------|------|
| `search:discover` | 自然言語で新しいツールを検索・インストール |
| `mcp:import` | MCP Server を Agent App としてインポート |
| `skill:import` | Skill パッケージを Agent App としてインポート |
| `listAllAaiApps` | 登録済みのすべての Agent App を一覧表示 |
| `enableApp` / `disableApp` | Agent ごとに Agent App を有効化・無効化 |
| `removeApp` | Agent App を削除 |
| `aai:exec` | Agent App 内の特定ツールを実行 |

インポートされた各 Agent App は **`app_<app-id>`** ツールを生成し、呼び出すと完全な操作ガイドとツールリストを返します。

### プリセット Agent App（ローカルにインストール済みの場合のみ自動検出）

| App ID | 名前 | 説明 |
|--------|------|------|
| `claude` | Claude Code | AI コーディングアシスタント、コード編集・分析・開発 |
| `codex` | Codex | OpenAI 搭載の AI コーディングアシスタント |
| `opencode` | OpenCode | AI 開発アシスタント、ファイル編集・コマンド実行 |

---

## アーキテクチャ

![アーキテクチャ](images/architecture.png)

---

## 開発者：Agent App を自動検出可能にする

`aai.json` 記述ファイルを作成し、`src/discovery/descriptors/` に提出してください。ユーザーのローカル環境が `discovery.checks` の条件を満たすと、Agent が自動的にあなたの Agent App を検出します。

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": { "default": "My App", "ja": "マイアプリ" }
  },
  "discovery": {
    "checks": [
      { "kind": "command", "command": "my-app" }
    ]
  },
  "access": {
    "protocol": "mcp",
    "config": {
      "command": "my-app-mcp",
      "args": ["--stdio"]
    }
  },
  "exposure": {
    "summary": "ユーザーが X をしたいときに使用。"
  }
}
```

`discovery.checks` は3種類のチェックをサポート：`command`（コマンドの存在）、`file`（ファイルの存在）、`path`（ディレクトリの存在）。

サポートされるプロトコル：`mcp`、`skill`、`acp-agent`

新しい Agent App 記述ファイルの [PR を提出](../../pulls) するか、[Issue を作成](../../issues) してフィードバックをお寄せください。
