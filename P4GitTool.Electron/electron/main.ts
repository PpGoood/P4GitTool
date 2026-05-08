import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { startServer, stopServer } from './server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 文件日志系统 ──────────────────────────────────────────
// 日志写到 exe 旁边的 p4git.log，方便排查问题
function setupFileLogger() {
  const logPath = path.join(path.dirname(process.execPath), 'p4git.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  const timestamp = () => new Date().toISOString();
  const write = (level: string, args: any[]) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    logStream.write(`[${timestamp()}] [${level}] ${msg}\n`);
  };

  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  console.log = (...args) => { origLog(...args); write('INFO', args); };
  console.error = (...args) => { origError(...args); write('ERROR', args); };
  console.warn = (...args) => { origWarn(...args); write('WARN', args); };

  // 未捕获的异常也写入日志
  process.on('uncaughtException', (e) => {
    write('FATAL', [`uncaughtException: ${e.stack ?? e.message}`]);
  });
  process.on('unhandledRejection', (reason) => {
    write('FATAL', [`unhandledRejection: ${reason}`]);
  });

  logStream.write(`\n${'='.repeat(60)}\n[${timestamp()}] P4Git Tool 启动\n${'='.repeat(60)}\n`);
  console.log('[P4Git] log file:', logPath);
}

setupFileLogger();
// ─────────────────────────────────────────────────────────

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
      sandbox: false,
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

  // 通过 IPC 把端口暴露给 preload
  ipcMain.handle('get-api-port', () => serverPort);
  console.log('[P4Git] api port registered via IPC:', serverPort);

  await createWindow(serverPort);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(serverPort);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
