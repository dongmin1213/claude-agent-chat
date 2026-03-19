"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import type { ProjectInfo, DevServerState, ProjectFramework, AppSettings } from "@/types/chat";

interface PreviewPanelProps {
  cwd: string;
  appSettings: AppSettings;
}

interface AdbDevice {
  id: string;
  status: string;
  model?: string;
  product?: string;
}

interface ScrcpyState {
  status: "stopped" | "starting" | "running" | "error";
  port: number;
  url: string | null;
  error: string | null;
  pid: number | null;
}

// =========================================
// Framework display info
// =========================================

const FRAMEWORK_LABELS: Record<ProjectFramework, string> = {
  nextjs: "Next.js", vite: "Vite", cra: "React (CRA)", "vue-cli": "Vue CLI",
  nuxt: "Nuxt", angular: "Angular", svelte: "SvelteKit", remix: "Remix",
  astro: "Astro", flutter: "Flutter", unknown: "Project",
};

const FRAMEWORK_COLORS: Record<ProjectFramework, string> = {
  nextjs: "bg-white/10 text-white", vite: "bg-purple-500/20 text-purple-300",
  cra: "bg-cyan-500/20 text-cyan-300", "vue-cli": "bg-emerald-500/20 text-emerald-300",
  nuxt: "bg-green-500/20 text-green-300", angular: "bg-red-500/20 text-red-300",
  svelte: "bg-orange-500/20 text-orange-300", remix: "bg-blue-500/20 text-blue-300",
  astro: "bg-indigo-500/20 text-indigo-300", flutter: "bg-sky-500/20 text-sky-300",
  unknown: "bg-gray-500/20 text-gray-300",
};

export default memo(function PreviewPanel({ cwd, appSettings }: PreviewPanelProps) {
  // ---- Dev Server State ----
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [serverState, setServerState] = useState<DevServerState>({
    status: "stopped", port: 0, url: null, error: null, pid: null,
  });
  const [customPort, setCustomPort] = useState<number>(3000);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<"preview" | "logs">("preview");
  const [panelMode, setPanelMode] = useState<"web" | "device">("web");
  const [killing, setKilling] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [manualUrlActive, setManualUrlActive] = useState(false);

  // ---- Device Mirror State ----
  const [devices, setDevices] = useState<AdbDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [scrcpyState, setScrcpyState] = useState<ScrcpyState>({
    status: "stopped", port: 0, url: null, error: null, pid: null,
  });
  const [scrcpyLogs, setScrcpyLogs] = useState<string[]>([]);
  const [deviceView, setDeviceView] = useState<"mirror" | "logs">("mirror");
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [streamPlayer, setStreamPlayer] = useState<"webcodecs" | "mse" | "broadway" | "tinyh264">("webcodecs");

  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const scrcpyEsRef = useRef<EventSource | null>(null);

  // ---- Auto-scroll logs ----
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, scrcpyLogs]);

  // ---- Detect project on cwd change ----
  useEffect(() => {
    setDetecting(true);
    setProjectInfo(null);
    setLogs([]);
    setManualUrlActive(false);

    fetch(`/api/detect-project?dir=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((project: ProjectInfo) => {
        setProjectInfo(project);
        const port = project.defaultPort || 3000;
        setCustomPort(port);
        return fetch("/api/dev-server", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", cwd, port }),
        }).then((r) => r.json());
      })
      .then((status) => {
        if (status.status !== "stopped") {
          setServerState(status as DevServerState);
          if (status.port) setCustomPort(status.port);
          if (status.status === "running") setActiveView("preview");
        } else {
          setServerState({ status: "stopped", port: 0, url: null, error: null, pid: null });
        }
        setDetecting(false);
      })
      .catch(() => setDetecting(false));
  }, [cwd]);

  // ---- SSE log subscription (dev server) with backoff reconnect ----
  useEffect(() => {
    if (serverState.status !== "starting" && serverState.status !== "running") {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }
    let cancelled = false;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      const es = new EventSource(`/api/dev-server-logs?cwd=${encodeURIComponent(cwd)}`);
      eventSourceRef.current = es;
      es.onopen = () => { retryCount = 0; };
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "log" && data.text) setLogs((prev) => prev.length >= 500 ? [...prev.slice(-200), data.text] : [...prev, data.text]);
          if (data.type === "status") {
            setServerState((prev) => ({ ...prev, status: data.status, url: data.url || prev.url, error: data.error || null }));
            if (data.status === "running") setActiveView("preview");
          }
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        es.close();
        if (cancelled) return;
        if (retryCount < 5) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 16000);
          retryCount++;
          retryTimer = setTimeout(connect, delay);
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [cwd, serverState.status]);

  // ---- SSE log subscription (scrcpy) with backoff reconnect ----
  useEffect(() => {
    if (scrcpyState.status !== "starting" && scrcpyState.status !== "running") {
      scrcpyEsRef.current?.close();
      scrcpyEsRef.current = null;
      return;
    }
    let cancelled = false;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      const es = new EventSource("/api/scrcpy");
      scrcpyEsRef.current = es;
      es.onopen = () => { retryCount = 0; };
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "log" && data.text) setScrcpyLogs((prev) => prev.length >= 300 ? [...prev.slice(-100), data.text] : [...prev, data.text]);
          if (data.type === "status") {
            setScrcpyState((prev) => ({ ...prev, status: data.status, url: data.url || prev.url, error: data.error || null }));
            if (data.status === "running") setDeviceView("mirror");
          }
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        es.close();
        if (cancelled) return;
        if (retryCount < 5) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 16000);
          retryCount++;
          retryTimer = setTimeout(connect, delay);
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      scrcpyEsRef.current?.close();
      scrcpyEsRef.current = null;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [scrcpyState.status]);

  // ---- Check scrcpy status + auto-refresh devices on device mode ----
  useEffect(() => {
    if (panelMode === "device") {
      fetch("/api/scrcpy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      }).then((r) => r.json()).then((s) => {
        if (s.status !== "stopped") setScrcpyState(s);
      }).catch(() => {});
      // Auto-refresh devices when entering device mode
      refreshDevices();
    }
  }, [panelMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Dev Server Handlers ----
  const handleStart = useCallback(async () => {
    if (!projectInfo) return;
    const port = customPort || projectInfo.defaultPort;
    setServerState({ status: "starting", port, url: `http://localhost:${port}`, error: null, pid: null });
    setLogs([]); setActiveView("logs");
    try {
      const res = await fetch("/api/dev-server", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", cwd, port, framework: projectInfo.isFlutter ? "flutter" : projectInfo.framework }),
      });
      const data = await res.json();
      setServerState((prev) => ({ ...prev, ...data }));
    } catch (err) {
      setServerState((prev) => ({ ...prev, status: "error", error: err instanceof Error ? err.message : "Failed to start" }));
    }
  }, [cwd, projectInfo, customPort]);

  const handleStop = useCallback(async () => {
    try { await fetch("/api/dev-server", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", cwd }) }); }
    catch { /* ignore */ }
    setServerState({ status: "stopped", port: 0, url: null, error: null, pid: null });
    setLogs([]);
  }, [cwd]);

  const handleForceStop = useCallback(async () => {
    const port = serverState.port || customPort;
    if (!port) return;
    setKilling(true);
    try {
      await fetch("/api/dev-server", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kill-port", cwd, port }) });
      await new Promise((r) => setTimeout(r, 500));
      setServerState({ status: "stopped", port: 0, url: null, error: null, pid: null });
      setLogs([]);
    } catch { /* ignore */ }
    setKilling(false);
  }, [cwd, serverState.port, customPort]);

  // ---- Device Mirror Handlers ----
  const refreshDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      // First scan existing devices
      const devRes = await fetch("/api/scrcpy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "devices" }),
      });
      const { devices: existing } = await devRes.json();

      let finalDevices: AdbDevice[] = [];
      if (existing && existing.length > 0) {
        finalDevices = existing;
      } else {
        // No devices found — try auto-connect MuMu then rescan
        const connectRes = await fetch("/api/scrcpy", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "connect-mumu" }),
        });
        const { devices: devs } = await connectRes.json();
        finalDevices = devs || [];
      }
      setDevices(finalDevices);
      // Auto-select first device if none selected
      if (finalDevices.length > 0 && !selectedDevice) {
        setSelectedDevice(finalDevices[0].id);
      }
    } catch { /* ignore */ }
    setLoadingDevices(false);
  }, [selectedDevice]);

  // Build ws-scrcpy stream URL for selected device
  const getStreamUrl = useCallback((baseUrl: string, udid: string, player: string): string => {
    const encodedUdid = encodeURIComponent(udid);
    const wsBase = baseUrl.replace(/^http/, "ws");
    const wsUrl = `${wsBase}/?action=proxy-adb&remote=tcp%3A8886&udid=${encodedUdid}`;
    return `${baseUrl}/#!action=stream&udid=${encodedUdid}&player=${player}&ws=${encodeURIComponent(wsUrl)}`;
  }, []);

  const startScrcpy = useCallback(async () => {
    const port = appSettings.wsScrcpyPort || 8000;
    setScrcpyState({ status: "starting", port, url: `http://localhost:${port}`, error: null, pid: null });
    setScrcpyLogs([]); setDeviceView("logs");
    try {
      const res = await fetch("/api/scrcpy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", wsScrcpyPath: appSettings.wsScrcpyPath, port }),
      });
      const data = await res.json();
      setScrcpyState((prev) => ({ ...prev, ...data }));
    } catch (err) {
      setScrcpyState((prev) => ({ ...prev, status: "error", error: err instanceof Error ? err.message : "Failed to start" }));
    }
  }, [appSettings.wsScrcpyPath, appSettings.wsScrcpyPort]);

  const stopScrcpy = useCallback(async () => {
    try { await fetch("/api/scrcpy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop" }) }); }
    catch { /* ignore */ }
    setScrcpyState({ status: "stopped", port: 0, url: null, error: null, pid: null });
    setScrcpyLogs([]);
  }, []);

  const handleReload = () => {
    const iframe = document.querySelector("#preview-iframe") as HTMLIFrameElement;
    if (iframe) iframe.src = iframe.src;
  };

  const handleManualGo = () => {
    if (manualUrl.trim()) {
      let finalUrl = manualUrl.trim();
      if (!finalUrl.startsWith("http")) finalUrl = "http://" + finalUrl;
      setServerState((prev) => ({ ...prev, url: finalUrl, status: "running" }));
      setManualUrlActive(true); setActiveView("preview");
    }
  };

  // ---- Derived state ----
  const isRunning = serverState.status === "running";
  const isStarting = serverState.status === "starting";
  const isStopped = serverState.status === "stopped";
  const isError = serverState.status === "error";
  const isPortOccupied = serverState.status === "port_occupied";
  const hasServer = isRunning || isStarting;
  const displayUrl = serverState.url || (manualUrlActive ? manualUrl : null);
  const label = projectInfo ? FRAMEWORK_LABELS[projectInfo.framework] : "Project";
  const badgeColor = projectInfo ? FRAMEWORK_COLORS[projectInfo.framework] : "";
  const isDeviceMode = panelMode === "device";

  // =========================================
  // Device Mirror Panel
  // =========================================
  const renderDevicePanel = () => {
    const scrcpyRunning = scrcpyState.status === "running";
    const scrcpyStarting = scrcpyState.status === "starting";
    const scrcpyError = scrcpyState.status === "error";
    const hasScrcpy = scrcpyRunning || scrcpyStarting;

    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary border-b border-border min-h-[36px]">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Device</span>
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300">Mirror</span>
          <div className="flex-1" />
          {/* Back to Web mode */}
          <button
            onClick={() => setPanelMode("web")}
            className="text-[10px] text-text-muted hover:text-text-primary"
          >
            ← Web Preview
          </button>
          {hasScrcpy && (
            <button onClick={stopScrcpy}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-red-500/20 text-red-400 rounded hover:bg-red-500/30"
            >
              <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1" /></svg>
              Stop
            </button>
          )}
        </div>

        {/* Content */}
        {scrcpyRunning && scrcpyState.url ? (
          <>
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-2 py-1 bg-bg-secondary border-b border-border">
              <button onClick={() => setDeviceView("mirror")}
                className={`px-2 py-0.5 text-[10px] rounded ${deviceView === "mirror" ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary"}`}
              >Mirror</button>
              <button onClick={() => setDeviceView("logs")}
                className={`px-2 py-0.5 text-[10px] rounded ${deviceView === "logs" ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary"}`}
              >Logs</button>
              {deviceView === "mirror" && (
                <>
                  <div className="w-px h-3 bg-border mx-0.5" />
                  {/* Player selector */}
                  <select value={streamPlayer} onChange={(e) => setStreamPlayer(e.target.value as typeof streamPlayer)}
                    className="text-[9px] bg-bg-tertiary border border-border rounded px-1 py-0.5 text-text-muted outline-none"
                  >
                    <option value="webcodecs">WebCodecs</option>
                    <option value="mse">H264 MSE</option>
                    <option value="broadway">Broadway</option>
                    <option value="tinyh264">TinyH264</option>
                  </select>
                  {/* Device selector (if multiple) */}
                  {devices.length > 1 && (
                    <select value={selectedDevice || ""} onChange={(e) => setSelectedDevice(e.target.value)}
                      className="text-[9px] bg-bg-tertiary border border-border rounded px-1 py-0.5 text-text-muted outline-none max-w-[120px]"
                    >
                      {devices.filter(d => d.status === "device").map((d) => (
                        <option key={d.id} value={d.id}>{d.model ? `${d.model} (${d.id})` : d.id}</option>
                      ))}
                    </select>
                  )}
                </>
              )}
              <div className="flex-1" />
              {deviceView === "mirror" && (
                <>
                  <button onClick={handleReload} className="text-text-muted hover:text-text-primary p-0.5" title="Reload">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M2 8a6 6 0 0111.5-2.3M14 8a6 6 0 01-11.5 2.3" />
                      <path d="M14 2v4h-4M2 14v-4h4" />
                    </svg>
                  </button>
                  <span className="text-[9px] text-text-muted truncate max-w-[100px]">{selectedDevice || "no device"}</span>
                </>
              )}
            </div>
            {deviceView === "mirror" ? (
              <div className="flex-1 bg-black">
                {selectedDevice ? (
                  <iframe
                    id="preview-iframe"
                    src={getStreamUrl(scrcpyState.url, selectedDevice, streamPlayer)}
                    className="w-full h-full border-0"
                    allow="autoplay"
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center h-full">
                    <div className="text-center">
                      <p className="text-[10px] text-text-muted mb-2">No device selected.</p>
                      <button onClick={refreshDevices} disabled={loadingDevices}
                        className="text-[10px] text-accent hover:text-accent-hover disabled:opacity-50"
                      >{loadingDevices ? "Scanning..." : "🔄 Refresh Devices"}</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-auto bg-[#0d1117] p-2 font-mono text-[11px] leading-relaxed">
                {scrcpyLogs.map((line, i) => (
                  <div key={i} className="text-gray-300 whitespace-pre-wrap break-all">{line}</div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </>
        ) : scrcpyStarting ? (
          <div className="flex-1 flex flex-col">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border-b border-border">
              <div className="animate-spin w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full" />
              <span className="text-[10px] text-accent">Starting ws-scrcpy...</span>
            </div>
            <div className="flex-1 overflow-auto bg-[#0d1117] p-2 font-mono text-[11px] leading-relaxed">
              {scrcpyLogs.length === 0 && <p className="text-gray-500 italic">Waiting for output...</p>}
              {scrcpyLogs.map((line, i) => (
                <div key={i} className="text-gray-300 whitespace-pre-wrap break-all">{line}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        ) : (
          /* Idle / Setup */
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center max-w-[300px]">
              {/* Device icon */}
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-bg-tertiary flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-sky-400">
                  <rect x="5" y="2" width="14" height="20" rx="2" />
                  <path d="M12 18h.01" />
                </svg>
              </div>

              <p className="text-xs text-text-primary font-medium mb-1">Device Mirroring</p>
              <p className="text-[10px] text-text-muted mb-4">
                Mirror Android device/emulator screen via ws-scrcpy
              </p>

              {/* ADB Devices */}
              <div className="mb-4 text-left">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-medium text-text-secondary">ADB Devices</span>
                  <button onClick={refreshDevices} disabled={loadingDevices}
                    className="text-[10px] text-accent hover:text-accent-hover disabled:opacity-50"
                  >
                    {loadingDevices ? "Scanning..." : "Refresh"}
                  </button>
                </div>
                {devices.length > 0 ? (
                  <div className="space-y-1">
                    {devices.map((d) => (
                      <button key={d.id} onClick={() => setSelectedDevice(d.id)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] w-full text-left transition-colors ${
                          selectedDevice === d.id
                            ? "bg-sky-500/20 border border-sky-500/40"
                            : "bg-bg-tertiary hover:bg-bg-tertiary/80 border border-transparent"
                        }`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${d.status === "device" ? "bg-green-400" : "bg-yellow-400"}`} />
                        <span className="text-text-primary font-mono flex-1 truncate">{d.id}</span>
                        <span className="text-text-muted">{d.model || d.status}</span>
                        {selectedDevice === d.id && <span className="text-sky-400 text-[8px]">✓</span>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-2 py-2 bg-bg-tertiary rounded text-[10px] text-text-muted text-center">
                    No devices found. Click Refresh to scan.
                  </div>
                )}
              </div>

              {/* Start / Error */}
              {!appSettings.wsScrcpyPath ? (
                <div className="p-2 bg-warning/10 border border-warning/30 rounded text-[10px] text-warning">
                  ws-scrcpy path not configured.<br />
                  Go to Settings → Device tab to set it up.
                </div>
              ) : scrcpyError ? (
                <div className="space-y-2">
                  {scrcpyState.error && (
                    <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-[10px] text-red-400">
                      {scrcpyState.error}
                    </div>
                  )}
                  <button onClick={startScrcpy}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-sky-500/20 text-sky-400 rounded-lg hover:bg-sky-500/30"
                  >Retry</button>
                </div>
              ) : (
                <button onClick={() => { refreshDevices(); startScrcpy(); }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-sky-500/20 text-sky-400 rounded-lg hover:bg-sky-500/30 transition-colors"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><polygon points="4,2 14,8 4,14" /></svg>
                  Start Mirroring
                </button>
              )}

              <p className="text-[9px] text-text-muted mt-2">
                Port {appSettings.wsScrcpyPort || 8000} · ws-scrcpy
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  // =========================================
  // Device mode → render device panel
  // =========================================
  if (isDeviceMode && !detecting) {
    return renderDevicePanel();
  }

  // =========================================
  // Web Preview Render (existing logic)
  // =========================================
  return (
    <div className="flex flex-col h-full">
      {/* ---- Header ---- */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary border-b border-border min-h-[36px]">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Preview</span>
        {projectInfo && projectInfo.framework !== "unknown" && (
          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${badgeColor}`}>{label}</span>
        )}
        {isPortOccupied && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-warning/20 text-warning">
            Port {serverState.port} in use
          </span>
        )}
        <div className="flex-1" />
        {projectInfo && projectInfo.framework !== "unknown" && (
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-text-muted">Port:</span>
            <input type="number" value={customPort} onChange={(e) => setCustomPort(Number(e.target.value) || 3000)} disabled={hasServer}
              className="w-14 px-1 py-0.5 text-[10px] bg-bg-secondary border border-border rounded text-text-primary text-center outline-none focus:border-accent/50 disabled:opacity-50" />
          </div>
        )}
        {isStopped && projectInfo && projectInfo.framework !== "unknown" && (
          <button onClick={handleStart} className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition-colors">
            <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor"><polygon points="4,2 14,8 4,14" /></svg>
            Run
          </button>
        )}
        {hasServer && (
          <button onClick={handleStop} className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors">
            <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1" /></svg>
            Stop
          </button>
        )}
        {(isPortOccupied || isError) && (
          <button onClick={handleForceStop} disabled={killing}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors disabled:opacity-50"
          >
            {killing ? <div className="animate-spin w-2.5 h-2.5 border border-red-400/30 border-t-red-400 rounded-full" /> :
              <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4l8 8M12 4l-8 8" /></svg>}
            {killing ? "Killing..." : "Force Stop"}
          </button>
        )}
        {(isRunning || manualUrlActive) && activeView === "preview" && (
          <button onClick={() => setActiveView("logs")} className="text-text-muted hover:text-text-primary" title="Show logs">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="3" width="14" height="10" rx="1" /><path d="M4 7l2 2 2-2" />
            </svg>
          </button>
        )}
        {/* Device Mirroring toggle */}
        <button onClick={() => setPanelMode("device")} className="text-text-muted hover:text-sky-400 transition-colors" title="Device Mirroring">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="5" y="2" width="14" height="20" rx="2" />
            <path d="M12 18h.01" />
          </svg>
        </button>
      </div>

      {/* ---- Content area ---- */}
      {detecting ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full mx-auto mb-2" />
            <p className="text-[10px] text-text-muted">Detecting project...</p>
          </div>
        </div>
      ) : isPortOccupied && !hasServer ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-[300px]">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-warning/10 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-warning">
                <path d="M12 9v4m0 4h.01" /><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <p className="text-xs text-text-primary font-medium mb-1">Port {serverState.port} is already in use</p>
            <p className="text-[10px] text-text-muted mb-1">{serverState.pid ? `PID: ${serverState.pid}` : "Unknown process"}</p>
            <p className="text-[10px] text-text-muted mb-4">A process is already running on this port.</p>
            <div className="flex flex-col items-center gap-2">
              <button onClick={handleForceStop} disabled={killing}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 disabled:opacity-50"
              >{killing ? <><div className="animate-spin w-3 h-3 border-2 border-red-400/30 border-t-red-400 rounded-full" />Stopping...</> :
                <><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4l8 8M12 4l-8 8" /></svg>Force Stop (Kill PID)</>}
              </button>
              <button onClick={() => { setServerState((prev) => ({ ...prev, status: "running" })); setActiveView("preview"); }}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-accent/20 text-accent rounded-lg hover:bg-accent/30"
              ><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 6h12" /></svg>Open in Preview</button>
              <p className="text-[9px] text-text-muted">Or change the port above and click Run</p>
            </div>
          </div>
        </div>
      ) : (isStopped || isPortOccupied) && !manualUrlActive ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-[280px]">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-bg-tertiary flex items-center justify-center">
              {projectInfo?.isFlutter ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-sky-400"><path d="M14.314 0L3.09 11.223l3.532 3.533L18.97 3.533h-4.656zm.012 11.224L8.782 16.77l3.533 3.532 5.542-5.544 5.543-5.533h-4.655l-4.42 1.999z" fill="currentColor" /></svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted"><rect x="2" y="3" width="20" height="18" rx="3" /><path d="M2 7h20" /><circle cx="5" cy="5" r="0.5" fill="currentColor" /><circle cx="7.5" cy="5" r="0.5" fill="currentColor" /><circle cx="10" cy="5" r="0.5" fill="currentColor" /></svg>
              )}
            </div>
            <p className="text-xs text-text-primary font-medium mb-1">{projectInfo?.name || cwd.split(/[\\/]/).pop()}</p>
            {projectInfo && projectInfo.framework !== "unknown" ? (
              <>
                <p className="text-[10px] text-text-muted mb-4">{label} project detected</p>
                <button onClick={handleStart} className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><polygon points="4,2 14,8 4,14" /></svg>
                  Run Dev Server
                </button>
                <p className="text-[9px] text-text-muted mt-2">Port {customPort} · {projectInfo.devCommand}</p>
              </>
            ) : (
              <>
                <p className="text-[10px] text-text-muted mb-4">No dev server detected</p>
                <div className="flex items-center gap-1 justify-center">
                  <input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleManualGo()}
                    placeholder="http://localhost:3000" className="px-2 py-1 text-xs bg-bg-tertiary border border-border rounded text-text-primary outline-none focus:border-accent/50 w-44" />
                  <button onClick={handleManualGo} className="px-2 py-1 text-xs bg-accent/20 text-accent rounded hover:bg-accent/30">Go</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 px-2 py-1 bg-bg-secondary border-b border-border">
            {isRunning && (
              <>
                <button onClick={() => setActiveView("preview")} className={`px-2 py-0.5 text-[10px] rounded ${activeView === "preview" ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary"}`}>Preview</button>
                <button onClick={() => setActiveView("logs")} className={`px-2 py-0.5 text-[10px] rounded ${activeView === "logs" ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary"}`}>Logs</button>
                <div className="w-px h-3 bg-border mx-1" />
              </>
            )}
            {isStarting && (<div className="flex items-center gap-1.5"><div className="animate-spin w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full" /><span className="text-[10px] text-accent">Starting {label}...</span></div>)}
            {isError && (<div className="flex items-center gap-1.5"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#ef4444" strokeWidth="2"><circle cx="8" cy="8" r="6" /><path d="M6 6l4 4M10 6l-4 4" /></svg><span className="text-[10px] text-red-400">Error</span></div>)}
            <div className="flex-1" />
            {displayUrl && isRunning && activeView === "preview" && (
              <><button onClick={handleReload} className="text-text-muted hover:text-text-primary p-0.5" title="Reload"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8a6 6 0 0111.5-2.3M14 8a6 6 0 01-11.5 2.3" /><path d="M14 2v4h-4M2 14v-4h4" /></svg></button>
              <span className="text-[9px] text-text-muted truncate max-w-[180px]">{displayUrl}</span></>
            )}
          </div>
          {(activeView === "preview" && (isRunning || manualUrlActive) && displayUrl) ? (
            <div className="flex-1 bg-white"><iframe id="preview-iframe" src={displayUrl} className="w-full h-full border-0" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" /></div>
          ) : (
            <div className="flex-1 overflow-auto bg-[#0d1117] p-2 font-mono text-[11px] leading-relaxed">
              {logs.length === 0 && isStarting && <p className="text-gray-500 italic">Waiting for output...</p>}
              {logs.map((line, i) => (<div key={i} className="text-gray-300 whitespace-pre-wrap break-all">{line}</div>))}
              {isError && serverState.error && (<div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-[10px]">{serverState.error}</div>)}
              {isError && (
                <div className="mt-3 flex gap-2">
                  <button onClick={handleStart} className="px-3 py-1 text-[10px] bg-accent/20 text-accent rounded hover:bg-accent/30">Retry</button>
                  <button onClick={handleForceStop} disabled={killing} className="px-3 py-1 text-[10px] bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 disabled:opacity-50">{killing ? "Killing..." : "Force Stop Port"}</button>
                  <button onClick={() => { setServerState({ status: "stopped", port: 0, url: null, error: null, pid: null }); setLogs([]); }}
                    className="px-3 py-1 text-[10px] bg-bg-tertiary text-text-muted rounded hover:text-text-primary">Dismiss</button>
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          )}
        </>
      )}
    </div>
  );
});
