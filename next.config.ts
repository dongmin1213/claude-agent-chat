import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "chokidar", "tree-kill", "node-pty"],

  // Limit file tracing to the project root to avoid EPERM errors
  // on Windows CI (GitHub Actions runner has restricted junction points)
  outputFileTracingRoot: __dirname,

  // Disable built-in image optimization — the app uses native <img> tags only,
  // so Sharp is not needed. This saves ~20 MB in the Electron bundle.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
