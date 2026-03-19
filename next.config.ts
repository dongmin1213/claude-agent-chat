import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "chokidar", "tree-kill", "node-pty"],

  // Disable built-in image optimization — the app uses native <img> tags only,
  // so Sharp is not needed. This saves ~20 MB in the Electron bundle.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
