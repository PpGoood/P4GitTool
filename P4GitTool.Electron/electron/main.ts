import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { startServer, stopServer } from './server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

// 默认工作目录：exe 旁边的 workspaces\ 文件夹
function getDefaultWorkspacesDir(): string {
  if (process.env.NODE_ENV === 'development') {
    return app.getPath('userData');
  }
  // app.getPath('exe') 在打包后返回真实的 exe 路径
  return path.join(path.dirname(app.getPath('exe')), 'workspaces');
}

async function createWindow(serverPort: number) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#2d2d2d',
      symbolColor: '#cccccc',
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--api-port=${serverPort}`],
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  let serverPort: number;
  try {
    serverPort = await startServer(getDefaultWorkspacesDir());
  } catch (e) {
    console.error('[P4Git] startServer failed:', e);
    serverPort = await startServer(app.getPath('userData'));
  }
  await createWindow(serverPort);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(serverPort);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
