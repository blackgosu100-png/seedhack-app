// 패널 화면에 노출하는 최소 API (Node 기능은 넘기지 않음)
const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = ["console", "live", "live:refresh", "nav", "exact:progress", "exact:item", "excel:log", "collect:changed", "ctabs", "auth", "update", "version", "listup:fill", "listup:add1688", "chat:count"];

contextBridge.exposeInMainWorld("signal", {
  invoke: (ch, data) => ipcRenderer.invoke(ch, data),
  on: (ch, cb) => {
    if (!CHANNELS.includes(ch)) return;
    ipcRenderer.on(ch, (_e, data) => cb(data));
  },
});
