import { contextBridge, ipcRenderer } from 'electron';

// 通过 IPC 从主进程获取 API 端口（比 additionalArguments 更可靠）
contextBridge.exposeInMainWorld('electron', {
  getApiPort: () => ipcRenderer.invoke('get-api-port'),
});
