# Claude Agent Chat

**🇺🇸 English** | [🇰🇷 한국어](./README.ko.md)

A desktop AI coding assistant with a chat-based UI — like KakaoTalk meets VS Code.

Built on Anthropic's [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), it gives Claude the ability to read/write files, run terminal commands, and manage your projects — all through a familiar chat interface. Runs in the browser or as a standalone Windows app.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) ![Next.js 15](https://img.shields.io/badge/Next.js_15-black?style=flat&logo=nextdotjs) ![Electron](https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_v4-06B6D4?style=flat&logo=tailwindcss&logoColor=white)

<!-- ![demo](./docs/demo.gif) -->

## Why?

I was using Claude Code in the terminal daily, but kept hitting the same friction — no easy copy-paste, no image attachments, no visual feedback.

Claude Desktop (claude.ai) solved some of that with its Code tab, but it shares infrastructure with the web app — when claude.ai goes down, Desktop goes down with it.

Then I discovered the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). Since it talks directly to the API, it doesn't depend on claude.ai's availability. I started with a browser prototype, then moved to Electron for a more minimal, native feel.

For the UX, I borrowed from **KakaoTalk** — a chat list on the left, pop-out windows for each conversation, unread badges, system tray. It turns out a messaging app is a surprisingly good shell for an AI coding agent.

|  | Claude Code (Terminal) | Claude Desktop | Claude Agent Chat |
|--|----------------------|----------------|-------------------|
| File read/write | ✅ | ✅ (Code tab) | ✅ |
| Terminal commands | ✅ | ✅ (Code tab) | ✅ |
| Copy & paste | ❌ Awkward in terminal | ✅ | ✅ |
| Image attachments | ❌ | ✅ | ✅ |
| Works when claude.ai is down | ✅ | ❌ Goes down together | ✅ |
| Multi-conversation | ❌ | Single thread | Multi-window (KakaoTalk-style) |
| Background tasks | ❌ Blocks terminal | ❌ | ✅ System tray + unread badges |
| Desktop app | Terminal only | Electron app | Electron app |

## Features

- **Multi-window** — Main window (chat list) + individual chat windows, KakaoTalk-style
- **System tray** — Minimizes to tray, AI streaming continues in background
- **Unread badges** — Red badge count + Windows taskbar overlay
- **Pin chats** — Pin important conversations to the top
- **Real-time streaming** — NDJSON-based token streaming
- **Model selection** — Opus / Sonnet / Haiku per chat
- **Mid-stream injection** — Send messages while AI is working; it reads them mid-turn (like Claude Code CLI)
- **Working directory** — Set CWD per chat, with direct path input
- **File explorer** — Tree view + syntax-highlighted preview + git status
- **Terminal** — Built-in terminal with xterm.js + node-pty (multi-tab)
- **Code blocks** — Shiki syntax highlighting, copy, HTML/SVG preview
- **Images** — Paste, drag & drop, click to zoom
- **MCP servers** — Connect to Playwright and other MCP servers
- **Conversation branching** — Fork conversations from any message
- **Plan Mode / AskUser** — Approve agent plans and answer questions
- **Dark / Light theme** — Synced across all windows in real-time
- **Cost tracking** — Token usage and cost per chat
- **Keyboard-first** — Full keyboard navigation (↑↓, Ctrl+N, Ctrl+K, etc.)
- **Accessibility** — Focus rings, WCAG AA contrast, aria-labels throughout

## Quick Start

### Download

Grab the latest `.exe` from [Releases](https://github.com/dongmin1213/claude-agent-chat/releases).

### Prerequisites

[Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) must be authenticated:

```bash
npm install -g @anthropic-ai/claude-code
claude   # authenticate via browser
```

### Run from Source

```bash
git clone https://github.com/dongmin1213/claude-agent-chat.git
cd claude-agent-chat
npm install
```

#### Browser mode
```bash
npm run dev          # http://localhost:3000
```

#### Electron desktop (dev)
```bash
npm run electron:dev
```

#### Build Windows exe
```bash
npm run electron:build
# Output: dist-electron/win-unpacked/Claude Agent Chat.exe
```

## Keyboard Shortcuts

### Main Window (Chat List)
| Shortcut | Action |
|----------|--------|
| `↑` / `↓` | Navigate chats |
| `Enter` | Open selected chat |
| `Ctrl+N` | New chat + open window |
| `Ctrl+K` | Focus search |
| `Ctrl+,` | Settings |
| `F2` | Rename chat |
| `Delete` | Delete chat |
| `ESC` | Hide window (minimize to tray) |

### Chat Window
| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Search in conversation |
| `Ctrl+E` | Toggle file explorer |
| `Ctrl+P` | File search |
| `` Ctrl+` `` | Toggle terminal |
| `Ctrl+Shift+E` | Export chat as markdown |
| `ESC` | Close modal → hide window |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/clear` | Clear current chat messages |
| `/compact [instruction]` | Compress conversation context |
| `/download <path>` | Download server file |
| `/export [md\|json]` | Export chat |
| `/help` | Show help |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router) |
| Desktop | Electron 41 (frameless, multi-window) |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| Agent SDK | @anthropic-ai/claude-agent-sdk |
| Syntax Highlighting | Shiki + CodeMirror 6 |
| Terminal | xterm.js + node-pty |
| Testing | Vitest |

## Scripts

```bash
npm run dev             # Next.js dev server
npm run build           # Production build
npm run electron:dev    # Electron dev mode
npm run electron:build  # Build Windows exe
npm run test            # Run tests
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## License

[MIT](./LICENSE) © Dongmin Kim
