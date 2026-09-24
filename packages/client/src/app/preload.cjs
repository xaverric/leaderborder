const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => () => ipcRenderer.invoke(channel);

contextBridge.exposeInMainWorld("leaderborder", {
  getState: invoke("state:get"),
  syncNow: invoke("sync:now"),
  login: invoke("auth:login"),
  copyCode: invoke("auth:copy-code"),
  openGithub: invoke("auth:open-github"),
  logout: invoke("auth:logout"),
  cursorLogin: invoke("cursor:login"),
  openLeaderboard: invoke("open:leaderboard"),
  quit: invoke("app:quit"),
  setLoginItem: (enabled) => ipcRenderer.invoke("login-item:set", enabled === true),
  onState: (callback) => {
    const listener = (_event, view) => callback(view);
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  },
});
