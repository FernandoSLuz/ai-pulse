import { contextBridge, ipcRenderer } from "electron";

/** Bridge exposed to the settings/control renderer. No Node access in the page. */
contextBridge.exposeInMainWorld("aiPulse", {
  getState: () => ipcRenderer.invoke("settings:getState"),
  setKey: (name: string, value: string) => ipcRenderer.invoke("settings:setKey", name, value),
  setPrefs: (prefs: unknown) => ipcRenderer.invoke("settings:setPrefs", prefs),
  serviceStart: () => ipcRenderer.invoke("service:start"),
  serviceStop: () => ipcRenderer.invoke("service:stop"),
  serviceRestart: () => ipcRenderer.invoke("service:restart"),
  serviceStatus: () => ipcRenderer.invoke("service:status"),
  toggleLeaderboard: (show: boolean) => ipcRenderer.invoke("leaderboard:toggle", show),
  openDashboard: () => ipcRenderer.invoke("app:openDashboard"),
  openLogs: () => ipcRenderer.invoke("app:openLogs"),
  openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  serverHealth: () => ipcRenderer.invoke("server:health"),
  apiGet: (path: string) => ipcRenderer.invoke("api:get", path),
  apiPut: (path: string, body: unknown) => ipcRenderer.invoke("api:put", path, body),
  onState: (cb: (state: unknown) => void) => {
    ipcRenderer.on("settings:state", (_e, state) => cb(state));
  },
});
