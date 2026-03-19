import { describe, it, expect } from "vitest";
import { detectProject, detectWebFramework, type FsLike, type PathLike } from "./detect-project";

// =========================================
// Mock fs/path
// =========================================

function makeMockFs(files: Record<string, string>): FsLike {
  return {
    existsSync: (p: string) => p in files,
    readFileSync: (p: string) => {
      if (p in files) return files[p];
      throw new Error("ENOENT");
    },
  };
}

const mockPath: PathLike = {
  basename: (p: string) => p.split(/[\\/]/).pop() || "",
  join: (...parts: string[]) => parts.join("/"),
};

// =========================================
// detectProject (full)
// =========================================

describe("detectProject", () => {
  it("detects Flutter project", () => {
    const fs = makeMockFs({ "/app/pubspec.yaml": "name: myapp" });
    const result = detectProject(fs, mockPath, "/app");
    expect(result.framework).toBe("flutter");
    expect(result.isFlutter).toBe(true);
    expect(result.defaultPort).toBe(8080);
    expect(result.flutterModes).toContain("web");
  });

  it("detects Next.js project", () => {
    const pkg = JSON.stringify({ dependencies: { next: "^15.0.0" }, scripts: { dev: "next dev" } });
    const fs = makeMockFs({ "/app/package.json": pkg });
    const result = detectProject(fs, mockPath, "/app");
    expect(result.framework).toBe("nextjs");
    expect(result.devCommand).toBe("npm run dev");
    expect(result.defaultPort).toBe(3000);
  });

  it("returns unknown for empty directory", () => {
    const fs = makeMockFs({});
    const result = detectProject(fs, mockPath, "/empty");
    expect(result.framework).toBe("unknown");
    expect(result.isFlutter).toBe(false);
  });

  it("returns unknown for invalid package.json", () => {
    const fs = makeMockFs({ "/app/package.json": "not json" });
    const result = detectProject(fs, mockPath, "/app");
    expect(result.framework).toBe("unknown");
  });
});

// =========================================
// detectWebFramework (unit)
// =========================================

describe("detectWebFramework", () => {
  it("detects Vite", () => {
    const result = detectWebFramework({ dependencies: { vite: "^5.0.0" }, scripts: { dev: "vite" } }, "my-app");
    expect(result.framework).toBe("vite");
    expect(result.defaultPort).toBe(5173);
  });

  it("detects CRA", () => {
    const result = detectWebFramework({ dependencies: { "react-scripts": "5" } }, "app");
    expect(result.framework).toBe("cra");
    expect(result.devCommand).toBe("npm start");
  });

  it("detects Nuxt", () => {
    const result = detectWebFramework({ dependencies: { nuxt: "^3.0.0" }, scripts: { dev: "nuxt dev" } }, "app");
    expect(result.framework).toBe("nuxt");
  });

  it("detects Angular", () => {
    const result = detectWebFramework({ dependencies: { "@angular/core": "^17" }, scripts: { start: "ng serve" } }, "app");
    expect(result.framework).toBe("angular");
    expect(result.defaultPort).toBe(4200);
  });

  it("detects Svelte/SvelteKit", () => {
    const result = detectWebFramework({ devDependencies: { "@sveltejs/kit": "^2" }, scripts: { dev: "vite dev" } }, "app");
    expect(result.framework).toBe("svelte");
    expect(result.defaultPort).toBe(5173);
  });

  it("detects Remix", () => {
    const result = detectWebFramework({ dependencies: { "@remix-run/react": "^2" }, scripts: { dev: "remix dev" } }, "app");
    expect(result.framework).toBe("remix");
  });

  it("detects Astro", () => {
    const result = detectWebFramework({ dependencies: { astro: "^4" }, scripts: { dev: "astro dev" } }, "app");
    expect(result.framework).toBe("astro");
    expect(result.defaultPort).toBe(4321);
  });

  it("detects Vue CLI", () => {
    const result = detectWebFramework({ dependencies: { vue: "^3", "@vue/cli-service": "^5" }, scripts: { serve: "vue-cli-service serve" } }, "app");
    expect(result.framework).toBe("vue-cli");
    expect(result.defaultPort).toBe(8080);
  });

  it("detects Vue with Vite (no cli-service)", () => {
    const result = detectWebFramework({ dependencies: { vue: "^3" }, scripts: { dev: "vite" } }, "app");
    expect(result.framework).toBe("vite");
  });

  it("uses pkg.name when available", () => {
    const result = detectWebFramework({ name: "custom-name", dependencies: { next: "^15" }, scripts: { dev: "next dev" } }, "dir-name");
    expect(result.name).toBe("custom-name");
  });

  it("falls back to dev script for unknown framework", () => {
    const result = detectWebFramework({ scripts: { dev: "node server.js" } }, "app");
    expect(result.framework).toBe("unknown");
    expect(result.devCommand).toBe("npm run dev");
  });

  it("falls back to start script for unknown framework", () => {
    const result = detectWebFramework({ scripts: { start: "node server.js" } }, "app");
    expect(result.framework).toBe("unknown");
    expect(result.devCommand).toBe("npm start");
  });

  it("returns empty for no scripts", () => {
    const result = detectWebFramework({}, "app");
    expect(result.framework).toBe("unknown");
    expect(result.devCommand).toBe("");
  });
});
