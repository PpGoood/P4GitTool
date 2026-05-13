import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { startServer, stopServer } from './server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 文件日志系统 ──────────────────────────────────────────
// 日志写到 exe 旁边的 p4git.log，方便排查问题
// 超过 5MB 时轮转到 p4git.log.1（最多保留 2 个文件）
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const LOG_KEEP = 2;

function rotateLogIfNeeded(logPath: string) {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size < LOG_MAX_BYTES) return;
    // 轮转：p4git.log.1 → 删除，p4git.log → p4git.log.1
    for (let i = LOG_KEEP - 1; i >= 1; i--) {
      const older = `${logPath}.${i}`;
      const newer = i === 1 ? logPath : `${logPath}.${i - 1}`;
      if (fs.existsSync(older)) fs.unlinkSync(older);
      if (fs.existsSync(newer)) fs.renameSync(newer, older);
    }
  } catch {
    // 轮转失败不影响主流程
  }
}

function setupFileLogger() {
  const logPath = path.join(path.dirname(process.execPath), 'p4git.log');
  rotateLogIfNeeded(logPath);
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
  // preload 必须在真实文件系统上（不能在 asar 内），所以用 app.asar.unpacked 路径
  const preloadPath = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, 'preload.js')
    : path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'dist-electron', 'preload.js');

  console.log('[P4Git] preload path:', preloadPath);
  console.log('[P4Git] preload exists:', fs.existsSync(preloadPath));
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
      preload: preloadPath,
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
  // 接收渲染进程日志
  ipcMain.on('renderer-log', (_event, msg: string) => {
    console.log('[RENDERER]', msg);
  });
  console.log('[P4Git] api port registered via IPC:', serverPort);

  await createWindow(serverPort);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(serverPort);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
