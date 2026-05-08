import express from 'express';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { setConfigPath, loadConfig, repoPath } from './services/config';
import { eventBus } from './services/eventBus';
import { WorkspaceWatcher } from './services/watcher';

import { eventsRouter } from './routes/events';
import { createConfigRouter } from './routes/config';
import { createWorkspaceRouter } from './routes/workspace';
import { createOperationsRouter } from './routes/operations';
import { createDiscardRouter } from './routes/discard';
import { createRollbackRouter } from './routes/rollback';

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as any).port;
      srv.close(() => resolve(port));
    });
  });
}

let watcher: WorkspaceWatcher | null = null;
const watchedStreams = new Set<string>();

/**
 * 启动已配置 stream 的文件监听。
 * 在首次启动和配置保存后调用。
 */
async function refreshWatcher(rootDir: string) {
  if (!watcher) return;
  const cfg = loadConfig();
  const active = new Set(cfg.streams.map(s => s.name));

  // 停掉已不在配置里的 stream
  for (const s of watchedStreams) {
    if (!active.has(s)) {
      await watcher.unwatch(s);
      watchedStreams.delete(s);
    }
  }

  // 启动新的 stream
  for (const s of cfg.streams) {
    if (!watchedStreams.has(s.name)) {
      const repo = repoPath(rootDir, s.name);
      try {
        await watcher.watch(s.name, repo);
        watchedStreams.add(s.name);
      } catch (err) {
        eventBus.emit({ type: 'log', line: `[WARN] 无法监听 ${s.name}: ${(err as Error).message}` });
      }
    }
  }
}

export async function startServer(defaultRootDir: string): Promise<number> {
  const port = await findAvailablePort();

  // 先用默认目录读配置，如果配置里有 workspaces_dir 则切换
  fs.mkdirSync(defaultRootDir, { recursive: true });
  const configFilePath = path.join(defaultRootDir, 'p4git.yaml');
  setConfigPath(configFilePath);

  const cfg = loadConfig();
  const rootDir = cfg.workspaces_dir
    ? cfg.workspaces_dir
    : defaultRootDir;

  // 确保实际工作目录存在
  fs.mkdirSync(rootDir, { recursive: true });

  console.log('[P4Git] defaultRootDir:', defaultRootDir);
  console.log('[P4Git] rootDir:', rootDir);
  console.log('[P4Git] config path:', configFilePath);

  // 装配 Express
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // 请求日志中间件
  app.use((req, _res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
  });

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  // /api 前缀
  app.use('/api', eventsRouter);
  app.use('/api', createConfigRouter(async () => { await refreshWatcher(rootDir); }));
  app.use('/api', createWorkspaceRouter(rootDir));
  app.use('/api', createOperationsRouter(rootDir));
  app.use('/api', createDiscardRouter(rootDir));
  app.use('/api', createRollbackRouter(rootDir));

  // 文件监听 → 总线事件
  watcher = new WorkspaceWatcher({ debounceMs: 500 });
  watcher.on('changed', (streamName) => {
    eventBus.emit({ type: 'files-changed', stream: streamName });
  });
  await refreshWatcher(rootDir);

  return new Promise<number>((resolve) => {
    app.listen(port, '127.0.0.1', () => {
      console.log(`[API] Server started on port ${port}`);
      resolve(port);
    });
  });
}

export async function stopServer(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
    watchedStreams.clear();
  }
}
