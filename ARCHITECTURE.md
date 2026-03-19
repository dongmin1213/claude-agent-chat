# Architecture

## 실행 모드

### 1. Electron 데스크톱 (멀티 윈도우 — 카카오톡 스타일)
```
┌─ Main Process (electron/main.js) ─────────────────────┐
│                                                        │
│  1. Next.js 서버를 child process로 실행                │
│  2. 서버 ready 감지 후 트레이 + 메인 윈도우 생성       │
│  3. chatWindows = Map<chatId, BrowserWindow>           │
│  4. isQuitting 플래그로 hide vs 진짜 종료 구분         │
│                                                        │
│  ┌─ System Tray ───────────────┐                       │
│  │  클릭: show/hide 토글       │                       │
│  │  우클릭: 열기/종료 메뉴     │                       │
│  │  오버레이: 안 읽음 뱃지     │                       │
│  └─────────────────────────────┘                       │
│                                                        │
│  ┌─ Main Window (?mode=main) ──┐  ┌─ Chat Window ──┐  │
│  │  채팅 리스트 (340px)         │  │  개별 채팅      │  │
│  │  키보드 네비게이션           │  │  TopBar + Chat  │  │
│  │  검색 + 새 채팅             │  │  + Input        │  │
│  │  핀/뱃지/미리보기           │  │  타이핑 버블    │  │
│  └─────────────────────────────┘  └─────────────────┘  │
│                                                        │
│  창 닫기 = hide() (렌더러 유지 → AI 스트리밍 계속)     │
│  ESC = 모달 닫기 우선 → 창 hide                        │
│                                                        │
│  IPC: per-window (BrowserWindow.fromWebContents)       │
│  IPC: set-tray-badge (Windows taskbar overlay)         │
│  테마 동기화: localStorage StorageEvent                │
└────────────────────────────────────────────────────────┘
```

### 2. 브라우저 모드
```
http://localhost:3000 → 기존 단일 페이지 레이아웃
[Sidebar | ChatArea + MessageInput]
```

## 데이터 흐름

```
User Input
  → POST /api/chat (message, sessionId, model, cwd, systemPrompt, maxTurns, mcpServers)
  → agent.ts: runAgent() → SDK query() → AsyncGenerator<StreamEvent>
  → API Route: NDJSON stream (Content-Type: application/x-ndjson)
  → Frontend: ReadableStream parsing → React state updates
```

## API 엔드포인트

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/chat` | 채팅 스트리밍 (NDJSON) |
| POST | `/api/chat/abort` | 스트리밍 중단 |
| GET | `/api/files?dir=` | 디렉토리 목록 |
| GET | `/api/file-content?path=` | 파일 내용 + 언어 |
| GET | `/api/file-search?dir=&q=` | 파일 이름 검색 |
| GET | `/api/git-status?dir=` | Git 상태 |
| GET | `/api/watch?dir=` | 파일 변경 SSE |
| GET | `/api/detect-project?dir=` | 프로젝트 프레임워크 감지 |
| POST | `/api/dev-server` | 개발 서버 start/stop/status |
| GET | `/api/dev-server-logs?cwd=` | 개발 서버 로그 SSE |
| POST/GET | `/api/terminal` | 터미널 create/write/resize/kill + SSE |
| POST/GET | `/api/scrcpy` | ws-scrcpy 관리 + SSE |
| POST | `/api/upload-images` | 이미지 업로드 (base64 → 파일) |
| GET | `/api/image?path=` | 이미지 서빙 |
| GET | `/api/download?path=` | 파일 다운로드 |

## 스트림 이벤트 프로토콜

```typescript
type StreamEvent =
  | { type: "session_init"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "text_done" }
  | { type: "tool_use_start"; toolName: string; toolUseId: string }
  | { type: "tool_use_input_delta"; partialJson: string }
  | { type: "tool_use_done"; toolUseId: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
  | { type: "turn_done" }
  | { type: "plan_approval"; allowedPrompts?; planContent? }
  | { type: "ask_user"; questions: AskUserQuestion[] }
  | { type: "result"; result: string; costUsd?; durationMs? }
  | { type: "error"; message: string }
```

## 핵심 설계

### Electron 멀티 윈도우 (카카오톡 스타일)
- **싱글 인스턴스 잠금**: `app.requestSingleInstanceLock()` — 중복 실행 방지, 두 번째 실행 시 기존 메인 창 복원 (카카오톡 동일)
- `electron/main.js`에서 `chatWindows = new Map()` 으로 채팅 창 추적
- **창 닫기 = hide()**: `isQuitting` 플래그가 false이면 `e.preventDefault()` + `win.hide()` — 렌더러가 살아있어 AI 스트리밍 중단 없음
- **시스템 트레이**: 클릭 show/hide 토글, 우클릭 "열기"/"종료" 메뉴
- **트레이 뱃지**: `set-tray-badge` IPC → `setOverlayIcon()` (Windows 태스크바 빨간 뱃지)
- **ESC 처리**: page.tsx에서 모달/검색 닫기 우선 → `electronAPI.close()` → main.js의 hide 핸들러
- `BrowserWindow.fromWebContents(event.sender)`로 per-window IPC 처리
- 줌 팩터는 메인 창에서 채팅 창으로 상속
- `setupZoomControls(win)` 재사용 함수로 모든 창에 적용
- `window-all-closed`에서 아무것도 안 함 (트레이가 앱 유지)

### 모드 감지 (page.tsx: useWindowMode)
- URL 파라미터 `?mode=main|chat&chatId=xxx` + `window.electronAPI` 존재 여부
- 브라우저 모드: 기존 사이드바 레이아웃 변경 없음
- 메인 모드: `MainListView` 컴포넌트 렌더링
- 채팅 모드: `TopBar + ChatArea + MessageInput` 렌더링

### 크로스 윈도우 동기화
- `localStorage`를 공유 상태 버스로 사용 (같은 origin)
- `StorageEvent`로 테마/설정 변경 실시간 반영
- 메인 창은 3초 폴링으로 채팅 리스트 동기화 (같은 창 업데이트 대비)

### Agent SDK 통합
- `delete process.env.CLAUDECODE` — 중첩 세션 에러 방지
- `permissionMode: "bypassPermissions"` — 자동 도구 실행
- `ExitPlanMode` / `AskUserQuestion` 도구 인터셉트 → 커스텀 이벤트 생성
- `/compact` → SDK 네이티브 컨텍스트 압축 (`compact_boundary` 이벤트)

### 안 읽은 뱃지 시스템
- `Chat.unreadCount` / `Chat.pinned` 필드 (`types/chat.ts`)
- `store.ts`: `incrementUnread()`, `resetUnread()`, `toggleChatPin()`
- 비활성 채팅에 `result`/`error`/`plan_approval`/`ask_user` 이벤트 발생 시 카운트 증가
- 채팅 선택 시 즉시 초기화
- `useEffect`로 총 unread 합산 → `electronAPI.setTrayBadge()` → 트레이 오버레이 반영

### 사이드바 UX
- **채팅 고정 (핀)**: `sortChats()`에서 pinned 채팅 상단 정렬, 핀 아이콘 + 토글 버튼
- **마지막 메시지 미리보기**: `getLastMessagePreview()` — 마지막 user/assistant 메시지 50자 truncate
- **안 읽음 뱃지**: 빨간 원 + 흰색 숫자 (99+ 최대), 접힌 뷰에서는 빨간 점
- **카카오톡 타이핑 인디케이터**: 말풍선 안 ● ● ● 바운스 애니메이션 (`bounce-dot` keyframes)

### 상태 관리
- React useState (외부 상태 라이브러리 없음)
- localStorage 기반 채팅 영속화 (base64 이미지 자동 제거로 쿼터 관리)
- 채팅별 독립 AbortController

### 에러 처리
- **React Error Boundary**: `ErrorBoundary` 컴포넌트로 앱 전체 감싸 — 컴포넌트 에러 시 복구 UI 표시
- 스트림 타임아웃: 10분 전체 + 5분 유휴
- SSE 재연결: 지수 백오프 (1s → 16s, 최대 5회)
- 에이전트 에러 분류: CLI 미설치, 레이트 리밋, 타임아웃, 인증, 네트워크

### UX / 접근성
- **키보드 포커스 링**: `:focus-visible` 전역 스타일 — Tab 이동 시 accent 색상 아웃라인
- **텍스트 대비 개선**: `--color-text-muted` #71717a → #8c8c96 (WCAG AA 준수)
- **aria-label**: 모든 아이콘 전용 버튼에 접근성 레이블 추가 (윈도우 컨트롤, 삭제, 핀, 내보내기 등)
- **설정 저장 피드백**: Save 클릭 시 "Settings saved" 성공 토스트
- **MCP 폼 검증**: 필수 필드 미입력 시 빨간 테두리 + 인라인 에러 메시지
- **채팅 삭제 Undo**: 삭제 시 5초간 "Undo" 액션 토스트 — 실수 복구 가능
- **스켈레톤 로딩**: 채팅 전환 시 깜빡임 대신 skeleton pulse 애니메이션
- **슬래시 명령어 발견성**: 입력 영역 하단에 `/` 커맨드 힌트 표시
- **에러 토스트 지속 시간**: error 12s, warning 8s로 증가 — 중요 알림 놓치지 않음
- **스크롤바 가시성**: 8px 너비 + 밝은 thumb 색상으로 스크롤 위치 파악 용이
- **도구 실행 경과 시간**: 실행 중인 도구 블록에 경과 초 표시
- **모바일 설정 모달**: `max-w-[95vw]` 반응형 — 작은 화면에서도 사용 가능

### 빌드 크기 최적화
- **`.next/cache` 제외**: electron-builder에서 빌드 캐시 번들 제외 (~239 MB 절감)
- **플랫폼 바이너리 제거**: Claude Agent SDK의 ripgrep 중 `x64-win32`만 포함, 나머지 5개 플랫폼 제외 (~50 MB 절감)
- **Sharp 제외**: `next/image` 미사용이므로 Sharp 이미지 라이브러리 번들 제외 (~20 MB 절감)
- **`images.unoptimized: true`**: Next.js 이미지 최적화 비활성화 (Sharp 불필요 명시)

### 성능
- React.memo (ChatArea, ExplorerPanel, Sidebar 등)
- Shiki 하이라이터 싱글턴 + 온디맨드 언어 로딩
- useCallback/useMemo로 불필요한 리렌더 방지

## 테스트

```bash
npm test              # 전체 테스트
npm run test:watch    # 워치 모드
npm run test:coverage # 커버리지
```

테스트 파일:
- `src/lib/store.test.ts` — 채팅 CRUD, 영속화, 브랜치, 내보내기
- `src/lib/detect-project.test.ts` — 11개 프레임워크 감지
- `src/lib/slash-commands.test.ts` — 커맨드 파싱 및 필터링
- `src/lib/dev-server-manager.test.ts` — 포트 유틸, 서버 생명주기
- `src/app/api/download/route.test.ts` — 파일 다운로드 API
