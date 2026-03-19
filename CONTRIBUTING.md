# Contributing to Claude Agent Chat

먼저, 기여에 관심을 가져주셔서 감사합니다! 🎉

First of all, thank you for your interest in contributing! 🎉

## 🌐 Language / 언어

이 프로젝트는 한국어와 영어 모두 환영합니다.
This project welcomes both Korean and English contributions.

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+
- **Claude Code CLI** authenticated (`npm i -g @anthropic-ai/claude-code && claude`)

### Setup

```bash
git clone https://github.com/dongmin1213/claude-agent-chat.git
cd claude-agent-chat
npm install
npm run dev          # Browser mode at http://localhost:3000
npm run electron:dev # Electron desktop mode
```

### Running Tests

```bash
npm run test          # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

## 📝 How to Contribute

### Reporting Bugs

1. [Issues](https://github.com/dongmin1213/claude-agent-chat/issues)에서 이미 보고된 버그인지 확인해주세요.
2. 새 이슈를 생성할 때 **Bug Report** 템플릿을 사용해주세요.
3. 재현 단계를 최대한 상세하게 작성해주세요.

### Suggesting Features

1. [Issues](https://github.com/dongmin1213/claude-agent-chat/issues)에서 이미 제안된 기능인지 확인해주세요.
2. **Feature Request** 템플릿을 사용해주세요.

### Pull Requests

1. 이 저장소를 **Fork** 합니다.
2. 새 브랜치를 생성합니다:
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. 변경사항을 커밋합니다:
   ```bash
   git commit -m "feat: add amazing feature"
   ```
4. 브랜치를 Push 합니다:
   ```bash
   git push origin feature/amazing-feature
   ```
5. **Pull Request**를 생성합니다.

## 💻 Development Guidelines

### Code Style

- **TypeScript** — 모든 새 코드는 TypeScript로 작성해주세요.
- **함수형 컴포넌트** — React 컴포넌트는 함수형으로 작성합니다.
- **Tailwind CSS v4** — 인라인 스타일 대신 Tailwind 클래스를 사용합니다.

### Commit Convention

[Conventional Commits](https://www.conventionalcommits.org/)를 따릅니다:

| Type | Description |
|------|-------------|
| `feat` | 새로운 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서 변경 |
| `style` | 코드 포맷팅 (동작 변경 없음) |
| `refactor` | 리팩토링 |
| `test` | 테스트 추가/수정 |
| `chore` | 빌드, 설정 변경 |

### Project Structure

```
src/
├── app/           # Next.js App Router (pages & API routes)
├── components/    # React components
├── lib/           # Core logic (agent, store, terminal, etc.)
└── types/         # TypeScript type definitions
electron/          # Electron main process
```

자세한 아키텍처는 [ARCHITECTURE.md](./ARCHITECTURE.md)를 참고하세요.

## 🧪 Testing

- 새로운 기능을 추가할 때는 테스트도 함께 작성해주세요.
- 기존 테스트가 통과하는지 확인해주세요: `npm run test`

## 📄 License

이 프로젝트에 기여하면 [MIT License](./LICENSE) 하에 배포됩니다.
