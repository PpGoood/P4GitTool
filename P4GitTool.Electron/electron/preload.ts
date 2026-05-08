import { contextBridge, ipcRenderer } from 'electron';

// 通过 IPC 从主进程获取 API 端口
contextBridge.exposeInMainWorld('electron', {
  getApiPort: () => ipcRenderer.invoke('get-api-port'),
  // 渲染进程日志转发到主进程（写入 p4git.log）
  log: (msg: string) => ipcRenderer.send('renderer-log', msg),
});
