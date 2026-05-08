import { contextBridge, ipcRenderer } from 'electron';

// 渲染进程日志 → 主进程 → p4git.log
function rlog(msg: string) {
  try {
    ipcRenderer.send('renderer-log', msg);
  } catch {}
}

rlog('preload: 开始初始化');
rlog(`preload: process.argv = ${JSON.stringify(process.argv)}`);
rlog(`preload: electron object exists = ${typeof ipcRenderer !== 'undefined'}`);

// 通过 IPC 从主进程获取 API 端口
const portPromise = ipcRenderer.invoke('get-api-port').then((port: number) => {
  rlog(`preload: IPC get-api-port 返回 ${port}`);
  return port;
}).catch((e: any) => {
  rlog(`preload: IPC get-api-port 失败 ${e.message}`);
  return 3001;
});

contextBridge.exposeInMainWorld('electron', {
  getApiPort: () => portPromise,
  log: (msg: string) => {
    try { ipcRenderer.send('renderer-log', msg); } catch {}
  },
});

rlog('preload: contextBridge 注册完成');
