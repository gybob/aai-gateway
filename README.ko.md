[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# AAI Gateway — 모든 AI 에이전트를 하나의 MCP로 관리

**MCP 서버와 스킬을 한 번만 설치하면 모든 AI 에이전트에서 공유. 재시작 불필요. 컨텍스트 폭발 없음. 그냥 질문하세요.**

[![npm 버전](https://img.shields.io/npm/v/aai-gateway)](https://www.npmjs.com/package/aai-gateway)
[![라이선스](https://img.shields.io/npm/l/aai-gateway)](./LICENSE)

<!-- TODO: 검색 → 확인 → 설치 → 에이전트 간 사용을 보여주는 GIF 데모 추가 -->

---

## 문제점

MCP 생태계가 성장함에 따라 모든 AI 에이전트 사용자가 같은 벽에 부딪힙니다:

| 문제점               | 발생 내용                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **컨텍스트 폭발**    | 10개 MCP 서버 × 5개 도구 = 50개의 전체 도구 스키마가 모든 프롬프트에 주입되어, 모델이 생각하기 전에 수천 개의 토큰을 소비 |
| **중복 설정**        | Claude Code, Codex, OpenCode — 같은 MCP 서버를 세 번 설정하고 수동으로 동기화 유지                                        |
| **재시작 필요**      | 새 MCP 추가? 에이전트 재시작. 매번.                                                                                       |
| **도구 찾기 어려움** | GitHub 검색, README 읽기, JSON 설정 복사, 연결 오류 디버깅 — 도구를 사용하기 전에 모두 필요                               |

## 해결책

AAI Gateway는 AI 에이전트와 모든 도구 사이에 위치합니다. 하나의 MCP 연결이数十 개를 대체합니다.

|                   | AAI Gateway 없음                 | AAI Gateway 있음                                       |
| ----------------- | -------------------------------- | ------------------------------------------------------ |
| **컨텍스트 비용** | 모든 프롬프트에 50개 도구 스키마 | 10개 1줄 요약 (각각 약 200자), 상세내용은 요청 시 로드 |
| **설정**          | 에이전트마다 MCP 설정            | 한 번 가져오기, 모든 에이전트가 즉시 공유              |
| **새 도구**       | 설치 후 에이전트 재시작          | 핫리로딩, 즉시 사용 가능                               |
| **도구 찾기**     | 수동 검색 + 설정 복사            | `"파일 시스템 MCP 찾아줘"` → 몇 초 내 설치             |

---

## 빠른 시작 (30초)

### 1. 에이전트에 AAI Gateway 추가

**Claude Code**

```bash
claude mcp add --scope user --transport stdio aai-gateway -- npx -y aai-gateway
```

**Codex**

```bash
codex mcp add aai-gateway -- npx -y aai-gateway
```

**OpenCode** — `~/.config/opencode/opencode.json`에 추가:

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

### 2. 사용 시작

AI 에이전트에게 직접 말하세요:

> "파일 시스템 MCP 찾아서 설치해줘"

> "이 MCP 가져와줘: `npx -y @anthropic-ai/mcp-server-fetch`"

> "내가 뭘 설치했어?"

그게 끝입니다. 설정 파일 편집이나 에이전트 재시작이 필요 없습니다.

---

## 작동 원리: 2단계 공개

이것이 핵심 혁신입니다. AAI Gateway는 모든 도구 스키마를 프롬프트에 던지는 대신 **점진적 공개**를 사용합니다:

```
┌─────────────────────────────────────────────────────────────────────┐
│  1단계 — 에이전트가 도구 목록에서 보는 것                           │
│                                                                     │
│  guide:filesystem    "로컬 파일 읽기/쓰기"                         │ ~50자
│  guide:github        "GitHub 저장소, 이슈, PR 관리"                 │ ~50자
│  guide:slack         "메시지 전송 및 Slack 채널 관리"                │ ~50자
│  ... (앱당 1줄, 파라미터 스키마 없음)                               │
├─────────────────────────────────────────────────────────────────────┤
│  2단계 — 에이전트가 파일 시스템 사용 결정                           │
│                                                                     │
│  → guide:filesystem 호출                                            │
│  ← 전체 도구 목록 + 파라미터 스키마 + 사용 예제 수신                  │
│  → aai:exec { app, tool, args }로 실행                              │
└─────────────────────────────────────────────────────────────────────┘
```

**계산**: 5개 도구를 가진 10개 MCP 서버 = 전통적인 설정에서 **50개 전체 스키마**. AAI Gateway = **10개 짧은 요약** + 필요 시 상세 로드. 컨텍스트 절약 **90%+**.

---

## 주요 기능

### 자연어로 검색 및 설치

필요한 것을 설명하면 AAI Gateway가 찾아드립니다. 신뢰할 수 있는 소스(공식 MCP 레지스트리, 큐레이션된 목록)를 검색하고 옵션을 제시하며 전체 가져오기 흐름을 처리합니다.

> "데이터베이스 쿼리용 MCP 찾아줘" → 검색 → 선택 → 가져오기 → 준비 완료

### 모든 MCP 서버 가져오기

표준 MCP 설정을 붙여넣고 에이전트에게 AAI Gateway를 통해 가져오라고 요청하세요.

**stdio MCP:**

```json
{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }
```

**원격 (Streamable HTTP):**

```json
{ "url": "https://example.com/mcp" }
```

**원격 (SSE):**

```json
{ "url": "https://example.com/sse", "transport": "sse" }
```

### 스킬 가져오기

로컬 또는 원격 스킬 패키지를 가져옵니다. AAI Gateway는 이를 관리 저장소에 복사하고 도구로 노출시킵니다. 향후 업데이트: 원격 소스からの 자동 스킬 업데이트 — 스킬 작성자가 사용자에게 업데이트를 푸시할 수 없는 문제 해결.

```json
{ "path": "/path/to/my-skill" }
```

### 에이전트 상호운용성 (ACP)

AAI Gateway는 인기 코딩 에이전트(Claude Code, Codex, OpenCode)를 기본 지원하며 제어 가능한 앱으로 노출합니다. 이것은 다음을 의미합니다:

- **한 에이전트로 다른 에이전트 오케스트레이션** — 예: Claude Code에 코드 작성시키고 다른 도구에서 리뷰
- **원격 작업** — 외출 중에 전화로 코딩 에이전트에 지시

### 에이전트별 제어

한 번의 가져오기가 모든 에이전트에 서비스를 제공하지만, 가시성을 미세 조정할 수 있습니다:

- `enableApp` / `disableApp` — 에이전트별로 도구 전환
- `removeApp` — 완전히アンインストール
- `listAllAaiApps` — 등록된 모든 항목 보기

### 기본 제공 ACP 에이전트

AAI Gateway에는 인기 코딩 에이전트(Claude Code, Codex, OpenCode)의 디스크립터가 내장되어 있습니다. 시작 시 자동으로 등록됩니다 — 수동 가져오기가 필요 없습니다.

---

## 기본 제공 도구

| 도구              | 설명                                                 |
| ----------------- | ---------------------------------------------------- |
| `listAllAaiApps`  | AAI Gateway가 관리하는 모든 앱 나열                  |
| `enableApp`       | 현재 에이전트에 대해 앱 활성화                       |
| `disableApp`      | 현재 에이전트에 대해 앱 비활성화                     |
| `removeApp`       | 시스템에서 앱 제거                                   |
| `aai:exec`        | 관리 앱에서 특정 도구 실행 (`app` + `tool` + `args`) |
| `mcp:import`      | MCP 서버 가져오기                                    |
| `skill:import`    | 스킬 패키지 가져오기                                 |
| `skill:create`    | AAI Gateway가 관리하는 새 스킬 생성                  |
| `search:discover` | 자연어로 도구 또는 스킬 검색                         |

또한 가져온 각 앱에 대한 **`guide:<app-id>`** 도구 — 파라미터 없음, 호출 시 전체 작업 가이드 반환.

---

## 아키텍처

![아키텍처](images/architecture.png)

---

## 사용 사례

### "15개의 MCP가 있고 컨텍스트가 폭발하고 있어"

AAI Gateway의 2단계 공개는 컨텍스트 토큰 사용량을 90%+ 절감합니다. 에이전트는 15개의 전체 도구 스키마가 아닌 짧은 요약만 봅니다.

### "Claude Code와 OpenCode를 다 써"

AAI Gateway를 통해 한 번 가져오기. 두 에이전트가 즉시 같은 도구를 봅니다. 내일 Codex 추가 — 그것도 획득, 추가 설정 제로.

### "차 마시면서 코드 짜고 싶어"

ACP 에이전트 설정. 모든 에이전트(甚至电话上的)를 사용하여 Claude Code나 Codex에 워크스테이션에서 코드 작성, 테스트 및 커밋 지시.

### "어떤 MCP를 써야 할지 모르겠어"

只需要描述你的需求：`"PostgreSQL을 查询하는 도구가 필요해"`. AAI Gateway가 신뢰할 수 있는 레지스트리를 검색하고 전체 설치 처리.

---

## 앱 개발자를 위한: AAI 설명자

AAI Gateway에서 앱을 사용하고 싶으신가요? `aai.json` 설명자를 만드세요:

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": { "default": "My App" }
  },
  "access": {
    "protocol": "mcp",
    "config": {
      "command": "my-app-mcp",
      "args": ["--stdio"]
    }
  },
  "exposure": {
    "summary": "사용자가 My App으로 X를 하고 싶을 때 사용."
  }
}
```

지원되는 프로토콜: `mcp`, `skill`, `acp-agent`

`mcp:import` 또는 `skill:import`로 가져오거나 기본 제공 디스크립터로 번들합니다. 기본 제공 앱을 추가하고 싶으신가요? [PR 열기](../../pulls) — `src/discovery/descriptors/`의 예제를 참조하세요.

---

## 기여

기여는 환영합니다! AAI Gateway는 активно 개발 중입니다.

- [이슈 열기](../../issues) 버그 신고 또는 기능 제안
- [PR 제출](../../pulls) 코드 또는 새로운 앱 설명자 기여
