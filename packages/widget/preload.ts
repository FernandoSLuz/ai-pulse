import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("aiPulse", {
  version: "1.0.0",
  resizeWidget: (contentHeight: number) =>
    ipcRenderer.send("widget-resize", contentHeight),
  getMaxHeight: () => ipcRenderer.invoke("widget-max-height") as Promise<number>,
});
