// =========================================
// Project Detection Logic (extracted for testability)
// =========================================

export type ProjectFramework =
  | "nextjs" | "vite" | "cra" | "vue-cli" | "nuxt"
  | "angular" | "svelte" | "remix" | "astro"
  | "flutter" | "unknown";

export interface ProjectInfo {
  framework: ProjectFramework;
  name: string;
  devCommand: string;
  defaultPort: number;
  isFlutter: boolean;
  flutterModes?: ("web" | "device")[];
}

export interface FsLike {
  existsSync(path: string): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readFileSync(path: string, encoding: any): string;
}

export interface PathLike {
  basename(p: string): string;
  join(...paths: string[]): string;
}

export function detectProject(fs: FsLike, path: PathLike, dir: string): ProjectInfo {
  const name = path.basename(dir);

  // 1. Check Flutter (pubspec.yaml)
  const pubspecPath = path.join(dir, "pubspec.yaml");
  if (fs.existsSync(pubspecPath)) {
    return {
      framework: "flutter",
      name,
      devCommand: "flutter run -d web-server",
      defaultPort: 8080,
      isFlutter: true,
      flutterModes: ["web", "device"],
    };
  }

  // 2. Check Web (package.json)
  const packageJsonPath = path.join(dir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const raw = fs.readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(raw);
      return detectWebFramework(pkg, name);
    } catch {
      return { framework: "unknown", name, devCommand: "", defaultPort: 3000, isFlutter: false };
    }
  }

  // 3. Unknown
  return { framework: "unknown", name, devCommand: "", defaultPort: 3000, isFlutter: false };
}

export function detectWebFramework(pkg: Record<string, unknown>, name: string): ProjectInfo {
  const deps = {
    ...(pkg.dependencies as Record<string, string> || {}),
    ...(pkg.devDependencies as Record<string, string> || {}),
  };
  const scripts = (pkg.scripts as Record<string, string>) || {};

  let framework: ProjectFramework = "unknown";
  let defaultPort = 3000;
  let devCommand = "";

  if (deps["next"]) {
    framework = "nextjs";
    defaultPort = 3000;
    devCommand = scripts.dev ? "npm run dev" : "npx next dev";
  } else if (deps["nuxt"] || deps["nuxt3"]) {
    framework = "nuxt";
    defaultPort = 3000;
    devCommand = scripts.dev ? "npm run dev" : "npx nuxt dev";
  } else if (deps["@remix-run/react"] || deps["@remix-run/dev"]) {
    framework = "remix";
    defaultPort = 3000;
    devCommand = scripts.dev ? "npm run dev" : "npx remix dev";
  } else if (deps["astro"]) {
    framework = "astro";
    defaultPort = 4321;
    devCommand = scripts.dev ? "npm run dev" : "npx astro dev";
  } else if (deps["svelte"] || deps["@sveltejs/kit"]) {
    framework = "svelte";
    defaultPort = 5173;
    devCommand = scripts.dev ? "npm run dev" : "npx vite dev";
  } else if (deps["@angular/core"]) {
    framework = "angular";
    defaultPort = 4200;
    devCommand = scripts.start ? "npm start" : "npx ng serve";
  } else if (deps["vue"]) {
    if (deps["@vue/cli-service"] || scripts.serve) {
      framework = "vue-cli";
      defaultPort = 8080;
      devCommand = scripts.serve ? "npm run serve" : "npm run dev";
    } else {
      framework = "vite";
      defaultPort = 5173;
      devCommand = scripts.dev ? "npm run dev" : "npx vite";
    }
  } else if (deps["vite"]) {
    framework = "vite";
    defaultPort = 5173;
    devCommand = scripts.dev ? "npm run dev" : "npx vite";
  } else if (deps["react-scripts"]) {
    framework = "cra";
    defaultPort = 3000;
    devCommand = "npm start";
  } else if (scripts.dev) {
    framework = "unknown";
    devCommand = "npm run dev";
  } else if (scripts.start) {
    framework = "unknown";
    devCommand = "npm start";
  }

  return {
    framework,
    name: (pkg.name as string) || name,
    devCommand,
    defaultPort,
    isFlutter: false,
  };
}
