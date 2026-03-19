const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Window controls
  minimize: () => ipcRenderer.invoke("window-minimize"),
  maximize: () => ipcRenderer.invoke("window-maximize"),
  close: () => ipcRenderer.invoke("window-close"),
  isMaximized: () => ipcRenderer.invoke("window-is-maximized"),

  // Listen for maximize state changes
  onMaximizeChange: (callback) => {
    const handler = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on("maximize-change", handler);
    return () => ipcRenderer.removeListener("maximize-change", handler);
  },

  // Zoom controls
  zoomIn: () => ipcRenderer.invoke("zoom-in"),
  zoomOut: () => ipcRenderer.invoke("zoom-out"),
  zoomReset: () => ipcRenderer.invoke("zoom-reset"),
  zoomGet: () => ipcRenderer.invoke("zoom-get"),

  // Multi-window
  openChatWindow: (chatId) => ipcRenderer.invoke("open-chat-window", chatId),
  closeChatWindow: (chatId) => ipcRenderer.invoke("close-chat-window", chatId),
  setWindowTitle: (title) => ipcRenderer.invoke("window-set-title", title),

  // Tray badge
  setTrayBadge: (count) => ipcRenderer.invoke("set-tray-badge", count),

  // Platform info
  platform: process.platform,
});
