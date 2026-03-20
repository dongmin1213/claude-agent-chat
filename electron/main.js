const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage } = require("electron");
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");

// ── Config ──────────────────────────────────────────────
const APP_NAME = "Claude Agent Chat";
const DEV_MODE = process.argv.includes("--dev");
const DEV_PORT = 13370; // Must match the port in electron:dev script
const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

// ── Memory optimization flags ──────────────────────────
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=256");
app.commandLine.appendSwitch("disable-gpu-compositing");
// Reduce renderer memory overhead
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;

// Resolve app icon path (works in dev & packaged builds)
function getAppIconPath() {
  const candidates = [
    path.join(__dirname, "icon.png"),                              // Dev mode
    path.join(process.resourcesPath, "app", "electron", "icon.png"), // Packaged (no asar)
    path.join(process.resourcesPath, "icon.png"),                  // extraResources
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const APP_ICON_PATH = getAppIconPath();

let mainWindow = null;
const chatWindows = new Map(); // chatId → BrowserWindow
let serverProcess = null;
let serverPort = null;
let tray = null;
let isQuitting = false; // true = real quit, false = hide to tray

// ── Single Instance Lock (카카오톡처럼 중복 실행 방지) ──
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 이미 실행 중인 인스턴스가 있으면 즉시 종료
  app.quit();
} else {
  // 두 번째 인스턴스가 실행 시도 → 기존 메인 창 복원
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── Find system Node.js path ────────────────────────────
function findNodePath() {
  try {
    const cmd = process.platform === "win32" ? "where node" : "which node";
    const result = execSync(cmd, { encoding: "utf-8", timeout: 5000, windowsHide: true });
    return result.trim().split(/\r?\n/)[0];
  } catch {
    return "node";
  }
}

// ── Free port finder ────────────────────────────────────
function findFreePort(startPort = 13370) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, "0.0.0.0", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      resolve(findFreePort(startPort + 1));
    });
  });
}

// ── Window state persistence ────────────────────────────
function loadWindowState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch {}
  return null;
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  const isMaximized = mainWindow.isMaximized();
  const zoomFactor = mainWindow.webContents.getZoomFactor();
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ bounds, isMaximized, zoomFactor }, null, 2)
    );
  } catch {}
}

// ── Zoom controls (reusable for any window) ─────────────
function setupZoomControls(win) {
  win.webContents.on("before-input-event", (event, input) => {
    if (!input.control) return;
    const key = input.key;
    if ((key === "=" || key === "+") && input.type === "keyDown") {
      const current = win.webContents.getZoomFactor();
      win.webContents.setZoomFactor(Math.min(current + ZOOM_STEP, ZOOM_MAX));
      if (win === mainWindow) saveWindowState();
      event.preventDefault();
    } else if (key === "-" && input.type === "keyDown") {
      const current = win.webContents.getZoomFactor();
      win.webContents.setZoomFactor(Math.max(current - ZOOM_STEP, ZOOM_MIN));
      if (win === mainWindow) saveWindowState();
      event.preventDefault();
    } else if (key === "0" && input.type === "keyDown") {
      win.webContents.setZoomFactor(1.0);
      if (win === mainWindow) saveWindowState();
      event.preventDefault();
    }
  });

  win.webContents.on("zoom-changed", (event, zoomDirection) => {
    const current = win.webContents.getZoomFactor();
    if (zoomDirection === "in") {
      win.webContents.setZoomFactor(Math.min(current + ZOOM_STEP, ZOOM_MAX));
    } else {
      win.webContents.setZoomFactor(Math.max(current - ZOOM_STEP, ZOOM_MIN));
    }
    if (win === mainWindow) saveWindowState();
  });
}

// ── Open external links in default browser ──────────────
function setupExternalLinks(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Allow internal navigation (same origin)
    if (url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    // Block navigation away from our app
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

// ── Start Next.js server (production only) ──────────────
function startServer(port) {
  const appRoot = path.resolve(__dirname, "..");
  const nextBin = path.join(appRoot, "node_modules", "next", "dist", "bin", "next");
  const nodePath = findNodePath();

  console.log(`[electron] Starting Next.js production server on port ${port}...`);
  console.log(`[electron] Node: ${nodePath}`);
  console.log(`[electron] App root: ${appRoot}`);

  serverProcess = spawn(nodePath, [nextBin, "start", "--port", String(port)], {
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      ELECTRON: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  serverProcess.stdout.on("data", (data) => {
    console.log(`[next] ${data.toString().trim()}`);
  });
  serverProcess.stderr.on("data", (data) => {
    console.error(`[next:err] ${data.toString().trim()}`);
  });
  serverProcess.on("error", (err) => {
    console.error("[electron] Failed to start Next.js server:", err);
  });
  serverProcess.on("exit", (code) => {
    console.log(`[electron] Next.js server exited with code ${code}`);
    serverProcess = null;
  });

  return serverProcess;
}

// ── Wait for server ready ───────────────────────────────
function waitForServer(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("Server start timeout"));
      }
      const req = require("http").get(`http://127.0.0.1:${port}`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => setTimeout(check, 300));
      req.end();
    }
    check();
  });
}

// ── Create main window (chat list) ──────────────────────
function createWindow(port) {
  const saved = loadWindowState();
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  // Main window: narrow like KakaoTalk
  const defaults = {
    width: 340,
    height: Math.min(700, screenH),
    x: undefined,
    y: undefined,
  };

  const bounds = saved?.bounds || defaults;

  // Ensure window is within visible screen area
  const displays = screen.getAllDisplays();
  const isVisible = displays.some((d) => {
    const { x, y, width, height } = d.bounds;
    return (
      bounds.x >= x - 50 &&
      bounds.y >= y - 50 &&
      bounds.x < x + width + 50 &&
      bounds.y < y + height + 50
    );
  });

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: isVisible ? bounds.x : undefined,
    y: isVisible ? bounds.y : undefined,
    minWidth: 280,
    minHeight: 400,
    frame: false,
    backgroundColor: "#0a0a0a",
    show: false,
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
      spellcheck: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}?mode=main`);

  mainWindow.once("ready-to-show", () => {
    if (saved?.zoomFactor) {
      mainWindow.webContents.setZoomFactor(saved.zoomFactor);
    }
    if (saved?.isMaximized) {
      mainWindow.maximize();
    }
    mainWindow.show();
    mainWindow.focus();
  });

  // Save state on move/resize
  mainWindow.on("resize", saveWindowState);
  mainWindow.on("move", saveWindowState);
  mainWindow.on("maximize", () => {
    saveWindowState();
    mainWindow.webContents.send("maximize-change", true);
  });
  mainWindow.on("unmaximize", () => {
    saveWindowState();
    mainWindow.webContents.send("maximize-change", false);
  });

  // Hide to tray instead of closing (unless quitting)
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Free memory when hidden, reclaim when shown
  mainWindow.on("hide", () => {
    try { mainWindow.webContents.session.clearCache(); } catch {}
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  setupZoomControls(mainWindow);
  setupExternalLinks(mainWindow);

  if (DEV_MODE) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

// ── Create chat window ──────────────────────────────────
function createChatWindow(chatId) {
  // Show existing window if already open (visible or hidden)
  if (chatWindows.has(chatId)) {
    const existing = chatWindows.get(chatId);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return;
    }
    chatWindows.delete(chatId);
  }

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  // Offset each new window slightly so they don't stack exactly
  const offset = (chatWindows.size % 5) * 30;

  const chatWin = new BrowserWindow({
    width: 520,
    height: Math.min(820, screenH),
    x: undefined,
    y: undefined,
    minWidth: 320,
    minHeight: 400,
    frame: false,
    backgroundColor: "#0a0a0a",
    show: false,
    ...(APP_ICON_PATH ? { icon: APP_ICON_PATH } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
      spellcheck: false,
    },
  });

  chatWin.loadURL(`http://127.0.0.1:${serverPort}?mode=chat&chatId=${encodeURIComponent(chatId)}`);

  chatWin.once("ready-to-show", () => {
    // Apply same zoom factor as main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      const mainZoom = mainWindow.webContents.getZoomFactor();
      chatWin.webContents.setZoomFactor(mainZoom);
    }
    chatWin.show();
    chatWin.focus();
  });

  // Forward maximize state to renderer
  chatWin.on("maximize", () => {
    chatWin.webContents.send("maximize-change", true);
  });
  chatWin.on("unmaximize", () => {
    chatWin.webContents.send("maximize-change", false);
  });

  // Hide to tray instead of closing (keeps renderer alive for background AI)
  chatWin.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      chatWin.hide();
    }
  });

  chatWin.on("closed", () => {
    chatWindows.delete(chatId);
  });

  setupZoomControls(chatWin);
  setupExternalLinks(chatWin);
  chatWindows.set(chatId, chatWin);

  if (DEV_MODE) {
    // Don't auto-open devtools for chat windows in dev mode
  }
}

// ── IPC Handlers (per-window via event.sender) ──────────
ipcMain.handle("window-minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.minimize();
});

ipcMain.handle("window-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});

ipcMain.handle("window-close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

ipcMain.handle("window-is-maximized", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win?.isMaximized() ?? false;
});

// ── Zoom Handlers (per-window) ──────────────────────────
ipcMain.handle("zoom-in", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const current = win.webContents.getZoomFactor();
  const next = Math.min(current + ZOOM_STEP, ZOOM_MAX);
  win.webContents.setZoomFactor(next);
  if (win === mainWindow) saveWindowState();
  return next;
});

ipcMain.handle("zoom-out", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const current = win.webContents.getZoomFactor();
  const next = Math.max(current - ZOOM_STEP, ZOOM_MIN);
  win.webContents.setZoomFactor(next);
  if (win === mainWindow) saveWindowState();
  return next;
});

ipcMain.handle("zoom-reset", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.webContents.setZoomFactor(1.0);
  if (win === mainWindow) saveWindowState();
  return 1.0;
});

ipcMain.handle("zoom-get", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win?.webContents.getZoomFactor() ?? 1.0;
});

// ── Multi-window IPC ────────────────────────────────────
ipcMain.handle("open-chat-window", (event, chatId) => {
  createChatWindow(chatId);
});

ipcMain.handle("close-chat-window", (event, chatId) => {
  const win = chatWindows.get(chatId);
  if (win && !win.isDestroyed()) {
    win.hide(); // Hide instead of close to keep renderer alive
  }
});

ipcMain.handle("window-set-title", (event, title) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setTitle(title);
});

// ── Tray icon ──────────────────────────────────────────
function createTray() {
  // Load tray icon from file (works in both dev and packaged builds)
  const iconName = "tray-icon.png";
  const iconPaths = [
    path.join(__dirname, iconName),                              // Dev mode: electron/tray-icon.png
    path.join(process.resourcesPath, "app", "electron", iconName), // Packaged (no asar)
    path.join(process.resourcesPath, iconName),                  // extraResources fallback
  ];

  let icon = null;
  for (const p of iconPaths) {
    if (fs.existsSync(p)) {
      icon = nativeImage.createFromPath(p);
      if (!icon.isEmpty()) break;
    }
  }

  if (!icon || icon.isEmpty()) {
    // Fallback: simple 16x16 terracotta "C" square
    icon = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVQ4T2PU" +
      "PLXqPwMDA8N/BgYGRgYGBgYmBjIBIxMDAwMLA5mAhZGBgYGVgUzAysjAwEANLwAA8HwEEYfeyJEA" +
      "AAAASUVORK5CYII="
    );
  }
  // Resize for tray (16x16 is standard for Windows system tray)
  const trayIcon = icon.resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  tray.setToolTip(APP_NAME);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "열기",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "종료",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Click tray icon → show/hide main window
  tray.on("click", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// ── Tray badge (overlay icon for Windows taskbar) ──────
ipcMain.handle("set-tray-badge", (event, count) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (count > 0) {
    // Create a simple red badge with number
    const badgeSize = 16;
    const canvas = `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeSize}" height="${badgeSize}">
      <circle cx="8" cy="8" r="8" fill="#ef4444"/>
      <text x="8" y="12" text-anchor="middle" font-size="10" font-weight="bold" fill="white" font-family="Arial">${count > 99 ? "99+" : count}</text>
    </svg>`;
    const badge = nativeImage.createFromBuffer(
      Buffer.from(`data:image/svg+xml;base64,${Buffer.from(canvas).toString("base64")}`.replace("data:image/svg+xml;base64,", ""), "base64")
    );
    try {
      // Try SVG approach - if it fails, use simple overlay
      mainWindow.setOverlayIcon(
        nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(canvas).toString("base64")}`),
        `${count} unread`
      );
    } catch {
      // Fallback: just update tray tooltip
      if (tray) tray.setToolTip(`${APP_NAME} (${count} unread)`);
    }
  } else {
    mainWindow.setOverlayIcon(null, "");
    if (tray) tray.setToolTip(APP_NAME);
  }
});

// ── App lifecycle ───────────────────────────────────────
app.whenReady().then(async () => {
  // Single instance guard: 두 번째 인스턴스는 여기 도달 전에 quit 됨
  if (!gotTheLock) return;

  try {
    if (DEV_MODE) {
      serverPort = DEV_PORT;
      console.log(`[electron] Dev mode — connecting to existing Next.js server on port ${serverPort}`);
    } else {
      serverPort = await findFreePort();
      startServer(serverPort);
      await waitForServer(serverPort);
    }
    createTray();
    createWindow(serverPort);
  } catch (err) {
    console.error("[electron] Startup failed:", err);
    isQuitting = true;
    app.quit();
  }
});

// Prevent app quit when all windows are hidden (tray keeps it alive)
app.on("window-all-closed", () => {
  // Do nothing — tray keeps the app running
});

app.on("before-quit", () => {
  isQuitting = true;
  killServer();
});

function killServer() {
  if (serverProcess && !serverProcess.killed) {
    console.log("[electron] Killing Next.js server...");
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /PID ${serverProcess.pid} /T /F`, {
          timeout: 5000,
          windowsHide: true,
          stdio: "ignore",
        });
      } else {
        process.kill(-serverProcess.pid, "SIGTERM");
      }
    } catch {
      try { serverProcess.kill("SIGTERM"); } catch {}
    }
    serverProcess = null;
  }
}
