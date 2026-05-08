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

async function findAvailablePort(preferred = 3001): Promise<number> {
  // 先尝试固定端口 3001，失败再随机
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => {
      // 3001 被占用，随机找一个
      const srv2 = net.createServer();
      srv2.unref();
      srv2.on('error', () => resolve(preferred));
      srv2.listen(0, '127.0.0.1', () => {
        const port = (srv2.address() as any).port;
        srv2.close(() => resolve(port));
      });
    });
    srv.listen(preferred, '127.0.0.1', () => {
      srv.close(() => resolve(preferred));
    });
  });
}

let watcher: WorkspaceWatcher | null = null;
const watchedStreams = new Set<string>();

// 全局可变 rootDir，配置保存后可动态更新
let currentRootDir = '';

export function getRootDir(): string { return currentRootDir; }

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
  const port = await findAvailablePort(3001);

  // 先用默认目录读配置，如果配置里有 workspaces_dir 则切换
  fs.mkdirSync(defaultRootDir, { recursive: true });
  const configFilePath = path.join(defaultRootDir, 'p4git.yaml');
  setConfigPath(configFilePath);

  const cfg = loadConfig();
  currentRootDir = cfg.workspaces_dir ? cfg.workspaces_dir : defaultRootDir;

  // 确保实际工作目录存在
  fs.mkdirSync(currentRootDir, { recursive: true });

  console.log('[P4Git] defaultRootDir:', defaultRootDir);
  console.log('[P4Git] rootDir:', currentRootDir);
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

  // 配置保存后更新 rootDir 并刷新 watcher
  const onConfigChanged = async () => {
    const newCfg = loadConfig();
    const newRootDir = newCfg.workspaces_dir ? newCfg.workspaces_dir : defaultRootDir;
    if (newRootDir !== currentRootDir) {
      console.log('[P4Git] rootDir 更新:', newRootDir);
      currentRootDir = newRootDir;
      fs.mkdirSync(currentRootDir, { recursive: true });
    }
    await refreshWatcher(currentRootDir);
  };

  // /api 前缀（路由通过 getRootDir() 动态获取 rootDir）
  app.use('/api', eventsRouter);
  app.use('/api', createConfigRouter(onConfigChanged));
  app.use('/api', createWorkspaceRouter(() => currentRootDir));
  app.use('/api', createOperationsRouter(() => currentRootDir));
  app.use('/api', createDiscardRouter(() => currentRootDir));
  app.use('/api', createRollbackRouter(() => currentRootDir));

  // 文件监听 → 总线事件
  watcher = new WorkspaceWatcher({ debounceMs: 500 });
  watcher.on('changed', (streamName) => {
    eventBus.emit({ type: 'files-changed', stream: streamName });
  });
  await refreshWatcher(currentRootDir);

  return new Promise<number>((resolve) => {
    app.listen(port, '127.0.0.1', () => {
      console.log(`[API] Server started on port ${port}`);
      // 把端口写入文件，前端通过 /api/port 读取
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
