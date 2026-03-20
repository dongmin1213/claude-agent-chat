# Claude Agent Chat — 프로젝트 컨텍스트

## 개요
Claude Agent SDK 기반 데스크톱 채팅 앱. 브라우저(Next.js)와 Electron(Windows exe) 두 가지 모드 지원.
카카오톡 스타일 멀티 윈도우: 메인 창(채팅 리스트) + 개별 채팅 창.

## 기술 스택
- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Electron 41** (frameless, multi-window)
- **Tailwind CSS 4** (`@import "tailwindcss"` + `@theme`)
- **@anthropic-ai/claude-agent-sdk** — Claude Code CLI 래퍼
- **shiki** — 코드 구문 강조
- **@uiw/react-codemirror** — 파일 미리보기 에디터
- **@xterm/xterm + node-pty** — 내장 터미널
- **react-markdown + remark-gfm** — 마크다운 렌더링
- **chokidar** — 파일 변경 감지 (SSE)
- **vitest** — 테스트

## 아키텍처

### 멀티 윈도우 (Electron) — 카카오톡 스타일
```
┌─ Main Process (electron/main.js) ──────────────────┐
│  chatWindows = new Map<chatId, BrowserWindow>()     │
│  tray = Tray (시스템 트레이 상주)                    │
│  isQuitting = false (hide vs 진짜 종료 구분)        │
│                                                      │
│  Main Window ─── ?mode=main ─── 채팅 리스트 (340px) │
│  Chat Window ─── ?mode=chat&chatId=xxx ─── 개별 채팅│
│                                                      │
│  창 닫기 = hide() (렌더러 유지, AI 스트리밍 계속)   │
│  트레이 클릭 = show/hide 토글                        │
│  트레이 우클릭 = 열기/종료 메뉴                      │
│                                                      │
│  IPC: minimize/maximize/close/zoom (per-window)      │
│  IPC: open-chat-window/close-chat-window/set-title   │
│  IPC: set-tray-badge (Windows overlay icon)          │
│  Next.js 서버를 child process로 실행                 │
└──────────────────────────────────────────────────────┘
```

### 모드 감지 (page.tsx)
- `?mode=main` → MainListView (채팅 리스트만, 키보드 네비게이션)
- `?mode=chat&chatId=xxx` → TopBar + ChatArea + MessageInput
- 파라미터 없음 → 브라우저 모드 (기존 사이드바 레이아웃)
- 테마 변경 시 `StorageEvent`로 모든 창에 실시간 동기화

### 데이터 흐름
```
User Input → POST /api/chat (NDJSON stream)
           → agent.ts: AgentSession.run() → SDK query() + streamInput() → AsyncGenerator<StreamEvent>
           → Frontend: ReadableStream → React state

Mid-stream injection:
  User sends message while AI is working
  → POST /api/chat/inject → AgentSession.injectMessage()
  → query.interrupt() + streamInput() → AI reads mid-turn
```

## 디렉토리 구조
```
electron/
├── main.js              # Electron 메인 프로세스 (멀티 윈도우 + 트레이 + hide 관리)
└── preload.js           # IPC 브리지 (contextBridge + setTrayBadge)
src/
├── app/
│   ├── page.tsx          # 메인 오케스트레이터 (모드 감지, 상태 관리, 스트리밍, ESC/뱃지)
│   ├── layout.tsx        # 루트 레이아웃
│   ├── globals.css       # Tailwind v4 + 다크/라이트 테마 변수 + 타이핑 애니메이션
│   └── api/
│       ├── chat/route.ts         # NDJSON 스트리밍 API
│       ├── chat/abort/route.ts   # 스트리밍 중단
│       ├── chat/inject/route.ts # 스트리밍 중 메시지 끼어들기
│       ├── files/route.ts        # 디렉토리 목록
│       ├── file-content/route.ts # 파일 내용
│       ├── file-search/route.ts  # 파일 이름 검색
│       ├── git-status/route.ts   # Git 상태
│       ├── watch/route.ts        # 파일 변경 감지 (SSE)
│       ├── detect-project/route.ts  # 프로젝트 감지
│       ├── dev-server/route.ts      # 개발 서버 관리
│       ├── dev-server-logs/route.ts # 개발 서버 로그 SSE
│       ├── terminal/route.ts     # 터미널 (node-pty)
│       ├── scrcpy/route.ts       # ws-scrcpy 관리
│       ├── upload-images/route.ts # 이미지 업로드
│       ├── image/route.ts        # 이미지 서빙
│       └── download/route.ts     # 파일 다운로드
├── components/
│   ├── Sidebar.tsx         # 채팅 리스트 + 검색 + 드래그 정렬 + 핀 + 안읽음 뱃지 + 미리보기
│   ├── TopBar.tsx          # 모델/CWD 선택, 윈도우 컨트롤
│   ├── ChatArea.tsx        # 메시지 목록 + 고정 메시지 + 비용 표시 + 카카오톡 타이핑 인디케이터
│   ├── MessageBubble.tsx   # 개별 메시지 (마크다운/이미지/핀/편집)
│   ├── MessageInput.tsx    # 입력 + 파일 첨부 + 슬래시 커맨드
│   ├── CodeBlock.tsx       # 코드 블록 (Shiki + 복사 + HTML 미리보기)
│   ├── ToolBlock.tsx       # 도구 실행 표시 (Bash/Read/Write 등)
│   ├── ExplorerPanel.tsx   # 파일 트리 + CodeMirror 미리보기
│   ├── PreviewPanel.tsx    # 프로젝트 감지 + 개발 서버 + iframe
│   ├── TerminalPanel.tsx   # xterm.js 터미널 (멀티 탭)
│   ├── SettingsModal.tsx   # 설정 (채팅/MCP/디바이스)
│   ├── PlanApprovalBlock.tsx  # Plan Mode 승인 UI
│   ├── AskUserBlock.tsx    # 질문/응답 UI
│   ├── FileSearchModal.tsx # Ctrl+P 파일 검색
│   ├── FolderPicker.tsx    # 폴더 브라우저 (경로 직접 입력 지원)
│   ├── ImageModal.tsx      # 이미지 확대 모달
│   ├── ContextMenu.tsx     # 우클릭 메뉴
│   └── Toast.tsx           # 토스트 알림
├── lib/
│   ├── agent.ts            # SDK query() 래퍼 + AgentSession 클래스 (mid-stream injection, Plan/AskUser)
│   ├── store.ts            # localStorage CRUD (채팅 + 설정 + 안읽음/핀)
│   ├── shiki.ts            # Shiki 하이라이터 싱글턴
│   ├── slash-commands.ts   # 슬래시 커맨드 정의 + 파싱
│   ├── detect-project.ts   # 프로젝트 프레임워크 감지
│   ├── dev-server-manager.ts  # 개발 서버 프로세스 관리
│   ├── terminal-manager.ts    # 터미널 프로세스 관리
│   ├── codemirror-langs.ts    # CodeMirror 언어 로더
│   └── scrcpy-manager.ts     # ws-scrcpy 관리
└── types/
    └── chat.ts             # 타입 정의 (UIMessage, Chat, AppSettings 등)
```

## 핵심 설정

### agent.ts
- `delete process.env.CLAUDECODE` — 중첩 세션 에러 방지
- `permissionMode: "bypassPermissions"` — 자동 도구 실행
- 모델: opus → claude-opus-4-6, sonnet → claude-sonnet-4-6, haiku → claude-haiku-4-5
- 허용 도구: Read, Edit, Write, Bash, Glob, Grep, WebSearch, WebFetch, Task + MCP 도구

### next.config.ts
```ts
serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "chokidar", "tree-kill", "node-pty"]
```

### 실행 환경
- Claude Code CLI 인증 필요 (Claude Max 또는 API 키)
- Node.js가 PATH에 있어야 함

## 슬래시 커맨드
| 커맨드 | 동작 |
|--------|------|
| `/clear` | 메시지 초기화 + 세션 리셋 |
| `/compact [지시]` | SDK 네이티브 컨텍스트 압축 (세션 유지) |
| `/download <경로>` | 서버 파일 다운로드 |
| `/export [md\|json]` | 채팅 내보내기 |
| `/help` | 도움말 |

## 개발
```bash
npm run dev             # Next.js 개발 서버
npm run electron:dev    # Electron 개발 모드
npm run electron:build  # exe 빌드
npm run test            # 테스트
```

## 사용자 설정
- 한국어로 소통
- 자율적으로 진행 (확인 불필요)
- preview 도구 사용하지 않음, `npm run dev` 직접 실행
