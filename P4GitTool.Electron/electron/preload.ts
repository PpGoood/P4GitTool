import { contextBridge } from 'electron';

// 从 additionalArguments 读取 API 端口
const apiPortArg = process.argv.find((a) => a.startsWith('--api-port='));
const apiPort = apiPortArg ? apiPortArg.split('=')[1] : '3001';

contextBridge.exposeInMainWorld('electron', {
  apiPort: () => apiPort,
});
