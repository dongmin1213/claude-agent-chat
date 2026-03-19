/**
 * Electron Builder Configuration
 * Builds as unpacked directory (portable — just copy the folder and run)
 */
module.exports = {
  appId: "com.claude-agent-chat.app",
  productName: "Claude Agent Chat",
  directories: {
    output: "dist-electron",
  },

  // Skip native module rebuild — node-pty, chokidar etc. run in
  // a separate system Node.js process (Next.js server), not in Electron
  npmRebuild: false,

  // Include these files/folders in the build
  // NOTE: .next/cache is excluded (saves ~239 MB — it's a build cache, never needed at runtime)
  files: [
    "electron/**/*",
    ".next/static/**/*",
    ".next/server/**/*",
    ".next/types/**/*",
    ".next/*.json",
    ".next/BUILD_ID",
    "node_modules/**/*",
    "package.json",
    "next.config.ts",
    "src/**/*",
    "public/**/*",
    "postcss.config.mjs",
    "tsconfig.json",

    // ── Size optimizations ──
    // Exclude non-Windows ripgrep binaries from Claude Agent SDK (~50 MB saved)
    "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/arm64-darwin",
    "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/arm64-linux",
    "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/arm64-win32",
    "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/x64-darwin",
    "!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/x64-linux",

    // Exclude Sharp image processing — not used (native <img> only, no next/image)
    "!node_modules/@img/sharp*",
    "!node_modules/sharp",
  ],

  // Don't use asar for native module compatibility
  asar: false,

  // Windows — NSIS installer + unpacked directory
  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    icon: "electron/icon.ico",
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Claude Agent Chat",
  },

  // Extra resources
  extraResources: [],
};
