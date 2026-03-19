# Claude Agent Chat

[🇺🇸 English](./README.md) | **🇰🇷 한국어**

데스크톱 AI 코딩 어시스턴트 — 카카오톡 같은 채팅 UI로 Claude와 대화하면서 코딩하세요.

Anthropic의 [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) 기반으로, Claude가 파일을 읽고 쓰고, 터미널 명령을 실행하고, 프로젝트를 관리할 수 있습니다. 브라우저 또는 Windows 데스크톱 앱으로 실행 가능합니다.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) ![Next.js 15](https://img.shields.io/badge/Next.js_15-black?style=flat&logo=nextdotjs) ![Electron](https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_v4-06B6D4?style=flat&logo=tailwindcss&logoColor=white)

<!-- ![demo](./docs/demo.gif) -->

## 왜 만들었나요?

Claude Code를 터미널로 매일 쓰고 있었는데, 복사/붙여넣기가 불편하고 이미지 첨부도 안 되는 게 계속 걸렸습니다.

Claude Desktop(claude.ai)을 쓰면 Code 탭으로 어느 정도 해결되지만, 웹 앱과 인프라를 공유하다 보니 claude.ai가 장애나면 Desktop도 같이 먹통이 되는 일이 잦았습니다.

그러다 [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)를 발견했습니다. API를 직접 호출하기 때문에 claude.ai 웹 장애에는 영향을 받지 않습니다. 처음엔 브라우저로 프로토타입을 만들었다가, 더 미니멀한 느낌을 위해 Electron 데스크톱 앱으로 전환했습니다.

UX는 **카카오톡**에서 차용했습니다 — 왼쪽에 채팅 리스트, 대화별 팝업 창, 안 읽은 메시지 뱃지, 시스템 트레이. 메신저 앱이 AI 코딩 에이전트의 껍데기로 의외로 잘 맞더라고요.

|  | Claude Code (터미널) | Claude Desktop | Claude Agent Chat |
|--|----------------------|----------------|-------------------|
| 파일 읽기/쓰기 | ✅ | ✅ (Code 탭) | ✅ |
| 터미널 명령 실행 | ✅ | ✅ (Code 탭) | ✅ |
| 복사/붙여넣기 | ❌ 터미널이라 불편 | ✅ | ✅ |
| 이미지 첨부 | ❌ | ✅ | ✅ |
| claude.ai 장애 시 | ✅ 영향 없음 | ❌ 같이 먹통 | ✅ 영향 없음 |
| 멀티 대화 | ❌ | 단일 스레드 | 멀티 윈도우 (카카오톡 스타일) |
| 백그라운드 작업 | ❌ 터미널 점유 | ❌ | ✅ 시스템 트레이 + 안읽음 뱃지 |
| 데스크톱 앱 | 터미널 전용 | Electron 앱 | Electron 앱 |

## 주요 기능

- **멀티 윈도우** — 메인 창(채팅 리스트) + 개별 채팅 창 (카카오톡 스타일)
- **시스템 트레이** — 트레이 상주, 창 닫기 = hide (AI 스트리밍 백그라운드 유지)
- **안 읽은 메시지 뱃지** — 빨간 뱃지 카운트 + Windows 태스크바 오버레이
- **채팅 고정 (핀)** — 중요 채팅을 사이드바 상단에 고정
- **마지막 메시지 미리보기** — 채팅 리스트에서 최근 메시지 내용 표시
- **카카오톡 타이핑 인디케이터** — 말풍선 안 ● ● ● 바운스 애니메이션
- **키보드 네비게이션** — ↑↓ 선택, Enter 열기, Ctrl+N 새 채팅, Ctrl+K 검색, ESC 창 숨기기
- **실시간 스트리밍** — NDJSON 기반 토큰 스트리밍
- **모델 선택** — Opus / Sonnet / Haiku (채팅별)
- **작업 디렉토리** — 채팅별 CWD 설정
- **파일 탐색기** — 트리 뷰 + 구문 강조 미리보기 + git 상태
- **터미널** — xterm.js + node-pty 내장 터미널 (멀티 탭)
- **코드 블록** — Shiki 구문 강조, 복사, HTML/SVG 미리보기
- **이미지** — 붙여넣기, 드래그 앤 드롭, 클릭 확대
- **MCP 서버** — Playwright 등 MCP 서버 연동
- **대화 브랜치** — 메시지에서 분기
- **Plan Mode / AskUser** — 에이전트 계획 승인 및 질문 응답 UI
- **다크 / 라이트 테마** — 전체 창 실시간 동기화
- **비용 추적** — 채팅별 토큰 사용량 및 비용 표시
- **싱글 인스턴스** — 중복 실행 방지, 기존 창 복원 (카카오톡 동일)
- **채팅 삭제 Undo** — 실수로 삭제해도 5초 내 복구 가능
- **접근성** — 키보드 포커스 링, WCAG AA 텍스트 대비, aria-label 전체 적용
- **에러 복구** — React Error Boundary로 앱 크래시 방지
- **설정 저장 피드백** — 저장/검증 결과 토스트 알림

## 시작하기

### 다운로드

[Releases](https://github.com/dongmin1213/claude-agent-chat/releases)에서 최신 `.exe` 파일을 받으세요.

### 사전 요구사항

[Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) 인증이 필요합니다:

```bash
npm install -g @anthropic-ai/claude-code
claude  # 브라우저 인증
```

### 소스에서 실행

```bash
git clone https://github.com/dongmin1213/claude-agent-chat.git
cd claude-agent-chat
npm install
```

#### 브라우저 모드
```bash
npm run dev          # http://localhost:3000
```

#### Electron 데스크톱 (개발)
```bash
npm run electron:dev
```

#### Electron exe 빌드
```bash
npm run electron:build
# 결과: dist-electron/win-unpacked/Claude Agent Chat.exe
```

## 키보드 단축키

### 메인 창 (채팅 리스트)
| 단축키 | 동작 |
|--------|------|
| `↑` / `↓` | 채팅 선택 이동 |
| `Enter` | 선택한 채팅 창 열기 |
| `Ctrl+N` | 새 채팅 + 창 열기 |
| `Ctrl+K` | 검색 포커스 |
| `Ctrl+,` | 설정 |
| `F2` | 채팅 이름 변경 |
| `Delete` | 채팅 삭제 |
| `ESC` | 창 숨기기 (트레이로 최소화) |

### 채팅 창
| 단축키 | 동작 |
|--------|------|
| `Ctrl+F` | 대화 내 검색 |
| `Ctrl+E` | 파일 탐색기 토글 |
| `Ctrl+P` | 파일 검색 |
| `` Ctrl+` `` | 터미널 토글 |
| `Ctrl+Shift+E` | 채팅 마크다운 내보내기 |
| `ESC` | 모달 닫기 → 창 숨기기 (트레이로 최소화) |

## 슬래시 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/clear` | 현재 채팅 메시지 초기화 |
| `/compact [지시]` | 대화 컨텍스트 압축 (세션 유지) |
| `/download <경로>` | 서버 파일 다운로드 |
| `/export [md\|json]` | 채팅 내보내기 |
| `/help` | 도움말 |

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 프레임워크 | Next.js 15 (App Router) |
| 데스크톱 | Electron 41 (frameless, multi-window) |
| UI | React 19 + TypeScript |
| 스타일 | Tailwind CSS v4 |
| Agent SDK | @anthropic-ai/claude-agent-sdk |
| 구문 강조 | Shiki + CodeMirror 6 |
| 터미널 | xterm.js + node-pty |
| 테스트 | Vitest |

## 스크립트

```bash
npm run dev             # Next.js 개발 서버
npm run build           # 프로덕션 빌드
npm run electron:dev    # Electron 개발 모드
npm run electron:build  # Electron exe 빌드
npm run test            # 테스트 실행
```

## 아키텍처

[ARCHITECTURE.md](./ARCHITECTURE.md) 참조.

## Contributing

기여를 환영합니다! 자세한 내용은 [CONTRIBUTING.md](./CONTRIBUTING.md)를 참고해주세요.

## License

[MIT](./LICENSE) © Dongmin Kim
