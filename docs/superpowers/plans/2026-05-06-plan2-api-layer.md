# P4Git Tool 重构 — 计划2：API 层

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 Electron 内嵌的 Express API 层：新增时间线、diff、discard、rollback、watcher 推送等路由，删除 stash 路由，完善 SSE 事件类型。

**Architecture:** 保持现有 Express + SSE 架构。将单文件 `server.ts`（约 265 行）按职责拆分为 `server.ts`（启动与装配）+ `routes/` 目录下多个路由模块。SSE 统一事件通道：`log`（日志）、`files-changed`（文件监听触发）、`op-done`（长操作完成）。

**Tech Stack:** Express, SSE (Server-Sent Events), TypeScript

**前置条件：Plan 1 已完成。** 所有 operations.ts 新函数已存在。

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | `electron/server.ts` | 精简为启动装配，将路由拆分到 `routes/` |
| 新增 | `electron/routes/config.ts` | 配置读写 |
| 新增 | `electron/routes/workspace.ts` | status / changes / snapshots / diff |
| 新增 | `electron/routes/operations.ts` | init / pull / check-update / submit-prepare / submit-confirm / snapshot |
| 新增 | `electron/routes/discard.ts` | discard-file / discard-hunk / discard-line |
| 新增 | `electron/routes/rollback.ts` | rollback |
| 新增 | `electron/routes/events.ts` | SSE 统一事件通道（log/files-changed/op-done） |
| 新增 | `electron/services/eventBus.ts` | 全局事件总线（替代现有的 logSubscribers） |
| 修改 | `electron/main.ts` | 在启动时初始化 watcher，绑定到事件总线 |

---

## Task 0: 事件总线 eventBus.ts

统一的事件推送通道，避免 `server.ts` 中散落多个 `Set<Response>`。所有 SSE 订阅者共享一个总线。

**Files:**
- Create: `P4GitTool.Electron/electron/services/eventBus.ts`
- Test: `P4GitTool.Electron/electron/services/eventBus.test.ts`

- [ ] **Step 1: 先写失败的测试**

Create: `P4GitTool.Electron/electron/services/eventBus.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus, AppEvent } from './eventBus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('订阅者收到 emit 的事件', () => {
    const received: AppEvent[] = [];
    const unsub = bus.subscribe((e) => received.push(e));

    bus.emit({ type: 'log', line: 'hello' });
    bus.emit({ type: 'files-changed', stream: 'dev' });

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({ type: 'log', line: 'hello' });
    expect(received[1]).toEqual({ type: 'files-changed', stream: 'dev' });

    unsub();
  });

  it('取消订阅后不再接收', () => {
    const received: AppEvent[] = [];
    const unsub = bus.subscribe((e) => received.push(e));
    unsub();

    bus.emit({ type: 'log', line: 'x' });
    expect(received).toHaveLength(0);
  });

  it('多个订阅者独立收到事件', () => {
    const a: AppEvent[] = [];
    const b: AppEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    bus.emit({ type: 'op-done', op: 'pull', stream: 'dev', ok: true });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd P4GitTool.Electron && npm run test -- eventBus
```

Expected: 全部失败，eventBus.ts 不存在。

- [ ] **Step 3: 实现 eventBus.ts**

Create: `P4GitTool.Electron/electron/services/eventBus.ts`

```typescript
export type AppEvent =
  | { type: 'log'; line: string }
  | { type: 'files-changed'; stream: string }
  | { type: 'op-done'; op: string; stream: string; ok: boolean; detail?: string };

export type EventListener = (e: AppEvent) => void;

export class EventBus {
  private listeners = new Set<EventListener>();

  subscribe(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  emit(e: AppEvent): void {
    for (const l of this.listeners) {
      try { l(e); } catch { /* 一个订阅者异常不应影响其他 */ }
    }
  }
}

// 全局单例
export const eventBus = new EventBus();

/**
 * 便捷方法：创建一个 log 回调，emit 到总线。
 * 传给 operations 的 LogFn 参数。
 */
export function makeLogFn(): (line: string) => void {
  return (line) => eventBus.emit({ type: 'log', line });
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd P4GitTool.Electron && npm run test -- eventBus
```

Expected: 3 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/services/eventBus.ts P4GitTool.Electron/electron/services/eventBus.test.ts
git commit -m "feat: 新增全局事件总线 EventBus"
```

---

## Task 1: SSE 统一事件路由 routes/events.ts

把现有 `/api/log/stream` 的字符串流升级为统一 JSON 事件流 `/api/events`，客户端订阅一次即可收到日志、文件变化、操作完成三类事件。

**Files:**
- Create: `P4GitTool.Electron/electron/routes/events.ts`

- [ ] **Step 1: 创建 routes 目录**

```bash
cd P4GitTool.Electron && mkdir -p electron/routes
```

- [ ] **Step 2: 实现 events.ts**

Create: `P4GitTool.Electron/electron/routes/events.ts`

```typescript
import { Router, Response } from 'express';
import { eventBus } from '../services/eventBus';

export const eventsRouter = Router();

/**
 * SSE 统一事件流：日志、文件变化、操作完成等。
 * 事件格式：{"type":"log","line":"..."} 等
 */
eventsRouter.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 首次连接推送一个 ready 心跳
  res.write(`: connected\n\n`);

  const unsub = eventBus.subscribe((e) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  });

  // 周期性心跳防止代理断开（每 25 秒）
  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsub();
  });
});

/**
 * 兼容旧前端的 /log/stream 端点，只推送 log 类型事件的纯文本行。
 * 待 Plan 3 前端改造完成后可以删除。
 */
eventsRouter.get('/log/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const unsub = eventBus.subscribe((e) => {
    if (e.type === 'log') {
      res.write(`data: ${e.line}\n\n`);
    }
  });

  req.on('close', () => unsub());
});
```

- [ ] **Step 3: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add P4GitTool.Electron/electron/routes/events.ts
git commit -m "feat: 新增 SSE 统一事件路由 /api/events"
```

---

## Task 2: routes/config.ts — 配置读写

**Files:**
- Create: `P4GitTool.Electron/electron/routes/config.ts`

- [ ] **Step 1: 实现 config.ts**

Create: `P4GitTool.Electron/electron/routes/config.ts`

```typescript
import { Router } from 'express';
import { loadConfig, saveConfig } from '../services/config';

export const configRouter = Router();

configRouter.get('/config', (_req, res) => {
  res.json(loadConfig());
});

configRouter.post('/config', (req, res) => {
  try {
    saveConfig(req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/electron/routes/config.ts
git commit -m "feat: 拆分 config 路由"
```

---

## Task 3: routes/workspace.ts — 工作区查询路由

聚合工作区的只读查询：status、branches、changes、snapshots、diff。

**Files:**
- Create: `P4GitTool.Electron/electron/routes/workspace.ts`

- [ ] **Step 1: 实现 workspace.ts**

Create: `P4GitTool.Electron/electron/routes/workspace.ts`

```typescript
import { Router } from 'express';
import { app as electronApp } from 'electron';
import * as ops from '../services/operations';

export const workspaceRouter = Router();

function rootDir(): string {
  return electronApp.getPath('userData');
}

function requireStream(req: any, res: any): string | null {
  const stream = (req.query.stream ?? req.body?.stream) as string | undefined;
  if (!stream) {
    res.status(400).json({ error: 'stream required' });
    return null;
  }
  return stream;
}

workspaceRouter.get('/status', async (req, res) => {
  const stream = requireStream(req, res); if (!stream) return;
  try {
    const status = await ops.getStreamStatus(rootDir(), stream);
    res.json(status);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

workspaceRouter.get('/branches', async (req, res) => {
  const stream = requireStream(req, res); if (!stream) return;
  try {
    const status = await ops.getStreamStatus(rootDir(), stream);
    res.json({ branches: status.branches, current: status.branch });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

workspaceRouter.get('/changes', async (req, res) => {
  const stream = requireStream(req, res); if (!stream) return;
  try {
    const files = await ops.getChangedFiles(rootDir(), stream);
    res.json({ files });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

workspaceRouter.get('/snapshots', async (req, res) => {
  const stream = requireStream(req, res); if (!stream) return;
  const limit = parseInt((req.query.limit as string) ?? '100', 10);
  try {
    const snapshots = await ops.listSnapshots(rootDir(), stream, isNaN(limit) ? 100 : limit);
    res.json({ snapshots });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

workspaceRouter.get('/diff', async (req, res) => {
  const stream = requireStream(req, res); if (!stream) return;
  const filepath = req.query.path as string;
  if (!filepath) { res.status(400).json({ error: 'path required' }); return; }
  try {
    const diff = await ops.getFileDiff(rootDir(), stream, filepath);
    res.json({ diff });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/electron/routes/workspace.ts
git commit -m "feat: 拆分 workspace 查询路由"
```

---

## Task 4: routes/operations.ts — 写操作路由

init / pull / snapshot / check-update / submit-prepare / submit-confirm。这些是会产生状态变化的路由，调用对应的 operations 函数。

**Files:**
- Create: `P4GitTool.Electron/electron/routes/operations.ts`

- [ ] **Step 1: 实现 operations.ts**

Create: `P4GitTool.Electron/electron/routes/operations.ts`

```typescript
import { Router } from 'express';
import { app as electronApp } from 'electron';
import * as ops from '../services/operations';
import { eventBus, makeLogFn } from '../services/eventBus';

export const operationsRouter = Router();

function rootDir(): string {
  return electronApp.getPath('userData');
}

function emitDone(op: string, stream: string, ok: boolean, detail?: string) {
  eventBus.emit({ type: 'op-done', op, stream, ok, detail });
}

operationsRouter.post('/init', async (_req, res) => {
  res.json({ ok: true, message: 'started' });
  const log = makeLogFn();
  const ok = await ops.init(rootDir(), log);
  emitDone('init', '', ok);
});

operationsRouter.post('/pull', async (req, res) => {
  const { stream, scope = 'all', mode = 'standard' } = req.body ?? {};
  if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
  res.json({ ok: true, message: 'started' });
  const log = makeLogFn();
  const ok = await ops.pull(rootDir(), stream, scope, mode, log);
  emitDone('pull', stream, ok);
});

operationsRouter.post('/snapshot', async (req, res) => {
  const { stream, message } = req.body ?? {};
  if (!stream || !message) {
    res.status(400).json({ error: 'stream and message required' });
    return;
  }
  const log = makeLogFn();
  try {
    const ok = await ops.commitSnapshot(rootDir(), stream, message, log);
    emitDone('snapshot', stream, ok);
    res.json({ ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

operationsRouter.post('/check-update', async (req, res) => {
  const { stream } = req.body ?? {};
  if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
  const log = makeLogFn();
  try {
    const status = await ops.checkAndUpdate(rootDir(), stream, log);
    emitDone('check-update', stream, status === 'ready', status);
    res.json({ status });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

operationsRouter.post('/submit-prepare', async (req, res) => {
  const { stream } = req.body ?? {};
  if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
  res.json({ ok: true, message: 'started' });
  const log = makeLogFn();
  const result = await ops.submitPrepare(rootDir(), stream, log);
  emitDone('submit-prepare', stream, result.ok, result.changelist?.toString());
});

operationsRouter.post('/submit-confirm', async (req, res) => {
  const { stream } = req.body ?? {};
  if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
  res.json({ ok: true, message: 'started' });
  const log = makeLogFn();
  const ok = await ops.confirmSubmit(rootDir(), stream, log);
  emitDone('submit-confirm', stream, ok);
});
```

- [ ] **Step 2: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/electron/routes/operations.ts
git commit -m "feat: 拆分 operations 写操作路由"
```

---

## Task 5: routes/discard.ts — 撤销路由

还原文件、撤销 hunk、撤销单行。

**Files:**
- Create: `P4GitTool.Electron/electron/routes/discard.ts`

- [ ] **Step 1: 实现 discard.ts**

Create: `P4GitTool.Electron/electron/routes/discard.ts`

```typescript
import { Router } from 'express';
import { app as electronApp } from 'electron';
import * as ops from '../services/operations';
import { eventBus, makeLogFn } from '../services/eventBus';

export const discardRouter = Router();

function rootDir(): string {
  return electronApp.getPath('userData');
}

discardRouter.post('/discard-file', async (req, res) => {
  const { stream, path } = req.body ?? {};
  if (!stream || !path) {
    res.status(400).json({ error: 'stream and path required' });
    return;
  }
  const log = makeLogFn();
  try {
    const ok = await ops.discardFile(rootDir(), stream, path, log);
    eventBus.emit({ type: 'op-done', op: 'discard-file', stream, ok });
    res.json({ ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

discardRouter.post('/discard-hunk', async (req, res) => {
  const { stream, path, hunkIndex } = req.body ?? {};
  if (!stream || !path || hunkIndex === undefined) {
    res.status(400).json({ error: 'stream, path, hunkIndex required' });
    return;
  }
  const log = makeLogFn();
  try {
    const ok = await ops.discardHunk(rootDir(), stream, path, parseInt(hunkIndex, 10), log);
    eventBus.emit({ type: 'op-done', op: 'discard-hunk', stream, ok });
    res.json({ ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

discardRouter.post('/discard-line', async (req, res) => {
  const { stream, path, hunkIndex, lineIndex } = req.body ?? {};
  if (!stream || !path || hunkIndex === undefined || lineIndex === undefined) {
    res.status(400).json({ error: 'stream, path, hunkIndex, lineIndex required' });
    return;
  }
  const log = makeLogFn();
  try {
    const ok = await ops.discardLine(
      rootDir(), stream, path,
      parseInt(hunkIndex, 10), parseInt(lineIndex, 10),
      log
    );
    eventBus.emit({ type: 'op-done', op: 'discard-line', stream, ok });
    res.json({ ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/electron/routes/discard.ts
git commit -m "feat: 新增 discard 路由（file/hunk/line）"
```

---

## Task 6: routes/rollback.ts — 回滚路由

回滚到指定 commit。后端已经做工作区干净检查，前端也会做一次友好提示。

**Files:**
- Create: `P4GitTool.Electron/electron/routes/rollback.ts`

- [ ] **Step 1: 实现 rollback.ts**

Create: `P4GitTool.Electron/electron/routes/rollback.ts`

```typescript
import { Router } from 'express';
import { app as electronApp } from 'electron';
import * as ops from '../services/operations';
import { eventBus, makeLogFn } from '../services/eventBus';

export const rollbackRouter = Router();

function rootDir(): string {
  return electronApp.getPath('userData');
}

rollbackRouter.post('/rollback', async (req, res) => {
  const { stream, hash } = req.body ?? {};
  if (!stream || !hash) {
    res.status(400).json({ error: 'stream and hash required' });
    return;
  }
  const log = makeLogFn();
  try {
    const ok = await ops.rollbackTo(rootDir(), stream, hash, log);
    eventBus.emit({ type: 'op-done', op: 'rollback', stream, ok });
    res.json({ ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/electron/routes/rollback.ts
git commit -m "feat: 新增 rollback 路由"
```

---

## Task 7: 重写 server.ts — 装配所有路由

原 `server.ts` 里的所有内联路由删除，改为装配 `routes/` 下的各个 Router。同时启动时初始化 WorkspaceWatcher 并把文件变化事件接入总线。

**Files:**
- Modify: `P4GitTool.Electron/electron/server.ts`

- [ ] **Step 1: 读取当前 server.ts 的导出签名**

```bash
cd P4GitTool.Electron && grep -n "export" electron/server.ts
```

记录 `startServer` 的签名：当前返回端口号。

- [ ] **Step 2: 完整替换 server.ts**

Replace `P4GitTool.Electron/electron/server.ts` with:

```typescript
import express from 'express';
import net from 'net';
import path from 'path';
import { app as electronApp } from 'electron';
import { setConfigPath, loadConfig, repoPath } from './services/config';
import { eventBus } from './services/eventBus';
import { WorkspaceWatcher } from './services/watcher';

import { eventsRouter } from './routes/events';
import { configRouter } from './routes/config';
import { workspaceRouter } from './routes/workspace';
import { operationsRouter } from './routes/operations';
import { discardRouter } from './routes/discard';
import { rollbackRouter } from './routes/rollback';

async function findAvailablePort(start = 3001): Promise<number> {
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

/**
 * 启动已配置 stream 的文件监听。
 * 在首次启动和配置保存后调用。
 */
async function refreshWatcher(rootDir: string) {
  if (!watcher) watcher = new WorkspaceWatcher({ debounceMs: 500 });
  const cfg = loadConfig();
  const active = new Set(cfg.streams.map(s => s.name));

  // watcher 暂不支持枚举已 watch 的 stream，此处通过 unwatch 再 watch 的方式简化
  for (const s of cfg.streams) {
    const repo = repoPath(rootDir, s.name);
    try {
      await watcher.watch(s.name, repo);
    } catch (err) {
      eventBus.emit({ type: 'log', line: `[WARN] 无法监听 ${s.name}: ${(err as Error).message}` });
    }
  }
}

export async function startServer(): Promise<number> {
  const port = await findAvailablePort();
  const rootDir = electronApp.getPath('userData');

  // 配置文件路径
  setConfigPath(path.join(rootDir, 'p4git.yaml'));

  // 装配 Express
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // /api 前缀
  app.use('/api', eventsRouter);
  app.use('/api', configRouter);
  app.use('/api', workspaceRouter);
  app.use('/api', operationsRouter);
  app.use('/api', discardRouter);
  app.use('/api', rollbackRouter);

  // 文件监听 → 总线事件
  watcher = new WorkspaceWatcher({ debounceMs: 500 });
  watcher.on('changed', (streamName) => {
    eventBus.emit({ type: 'files-changed', stream: streamName });
  });
  await refreshWatcher(rootDir);

  // 配置保存后刷新 watcher（监听 op-done 事件暂不用，直接在 config 路由里触发会更简洁，但为保持 Task 2 简单此处用 hack：定期检查）
  // 简化：启动时加载一次即可，新增 stream 需要用户重启工具

  return new Promise<number>((resolve) => {
    app.listen(port, '127.0.0.1', () => resolve(port));
  });
}

export async function stopServer(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}
```

- [ ] **Step 3: 在 main.ts 中关闭 watcher**

Read: `P4GitTool.Electron/electron/main.ts`

确认当前文件末尾有 `app.on('window-all-closed', ...)`。修改为：

```typescript
import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { startServer, stopServer } from './server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

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
  const serverPort = await startServer();
  await createWindow(serverPort);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(serverPort);
  });
});

app.on('before-quit', async () => {
  await stopServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 4: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/server.ts P4GitTool.Electron/electron/main.ts
git commit -m "refactor: server.ts 装配化，启动时加载 watcher"
```

---

## Task 8: 配置保存后刷新 watcher

Task 7 留了一项后续工作：配置保存时需要重新 watch 新增/变更的 stream。本 Task 在 `routes/config.ts` 中注入一个回调完成它。

**Files:**
- Modify: `P4GitTool.Electron/electron/routes/config.ts`
- Modify: `P4GitTool.Electron/electron/server.ts`

- [ ] **Step 1: config.ts 支持保存后回调**

Replace `P4GitTool.Electron/electron/routes/config.ts`:

```typescript
import { Router } from 'express';
import { loadConfig, saveConfig } from '../services/config';

export type ConfigChangedHandler = () => Promise<void> | void;

export function createConfigRouter(onChanged?: ConfigChangedHandler): Router {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.json(loadConfig());
  });

  router.post('/config', async (req, res) => {
    try {
      saveConfig(req.body);
      if (onChanged) await onChanged();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

// 保留兼容的默认导出，无回调版本
export const configRouter = createConfigRouter();
```

- [ ] **Step 2: server.ts 调用工厂版本**

Modify `P4GitTool.Electron/electron/server.ts`：

把原来的 `import { configRouter } from './routes/config';` 改为：

```typescript
import { createConfigRouter } from './routes/config';
```

把 `app.use('/api', configRouter);` 改为：

```typescript
app.use('/api', createConfigRouter(async () => {
  await refreshWatcher(rootDir);
}));
```

- [ ] **Step 3: refreshWatcher 正确处理已删除的 stream**

修改 `refreshWatcher` 函数，让它能 unwatch 已移除的 stream：

```typescript
const watchedStreams = new Set<string>();

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
```

- [ ] **Step 4: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/routes/config.ts P4GitTool.Electron/electron/server.ts
git commit -m "feat: 配置保存后自动刷新 watcher"
```

---

## Task 9: 删除 stash 路由与 Plan 1 遗留的 stub

Plan 1 在 operations.ts 里保留了 `listStashes / createStash / popStash / dropStash` 空 stub 让编译通过。Plan 2 删除它们的所有调用方后，可以一次性清理。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/operations.ts`（删除 stub）
- 确认无其他引用

- [ ] **Step 1: 搜索残留引用**

```bash
cd P4GitTool.Electron && grep -rn "listStashes\|createStash\|popStash\|dropStash" electron/ src/
```

Expected：只在 `operations.ts` 中有定义（stub）。若 `src/` 还有引用，暂时保留 stub，Plan 3 清理完后再删。

- [ ] **Step 2: 若 src/ 还有引用（大概率有 `appStore.ts` 和 `StashPanel.tsx`），跳过 Step 3-4**

本 Task 在 Plan 3 完成后补充执行。这里只是文档占位。

- [ ] **Step 3 (前端清理后执行)：删除 operations.ts 中的 stub**

删除 `operations.ts` 中以下几行：

```typescript
export interface StashEntry { ... }
export async function listStashes(): Promise<StashEntry[]> { return []; }
export async function createStash(): Promise<boolean> { return false; }
export async function popStash(): Promise<boolean> { return false; }
export async function dropStash(): Promise<boolean> { return false; }
```

- [ ] **Step 4: 运行 lint 并提交**

```bash
cd P4GitTool.Electron && npm run lint
git add P4GitTool.Electron/electron/services/operations.ts
git commit -m "refactor: 删除 stash stub"
```

---

## Task 10: 集成测试 — 路由装配正确

启动 Express 实例（不带 Electron），发起几个代表性请求验证路由可达。

**Files:**
- Create: `P4GitTool.Electron/electron/server.test.ts`

- [ ] **Step 1: 写测试**

Create: `P4GitTool.Electron/electron/server.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';

// mock electron 模块（测试环境无 Electron runtime）
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      const os = require('os');
      const fs = require('fs');
      const p = require('path').join(os.tmpdir(), 'p4git-test-userdata');
      fs.mkdirSync(p, { recursive: true });
      return p;
    },
  },
}));

// mock watcher（避免创建真实文件监听）
vi.mock('./services/watcher', () => ({
  WorkspaceWatcher: class {
    on() { /* noop */ }
    async watch() { /* noop */ }
    async unwatch() { /* noop */ }
    async close() { /* noop */ }
  },
}));

import express from 'express';
import { eventsRouter } from './routes/events';
import { workspaceRouter } from './routes/workspace';
import { createConfigRouter } from './routes/config';

describe('API 路由装配', () => {
  it('configRouter GET /config 返回 200', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createConfigRouter());

    const srv = app.listen(0);
    const port = (srv.address() as any).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('streams');

    srv.close();
  });

  it('workspaceRouter 缺少 stream 返回 400', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', workspaceRouter);

    const srv = app.listen(0);
    const port = (srv.address() as any).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(res.status).toBe(400);

    srv.close();
  });

  it('events 端点返回 text/event-stream', async () => {
    const app = express();
    app.use('/api', eventsRouter);

    const srv = app.listen(0);
    const port = (srv.address() as any).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // 取消订阅释放连接
    res.body?.cancel();

    srv.close();
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd P4GitTool.Electron && npm run test -- server
```

Expected: 3 个测试全部通过。

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/electron/server.test.ts
git commit -m "test: API 路由装配集成测试"
```

---

## Task 11: 最终 lint + 全部测试

- [ ] **Step 1: lint**

```bash
cd P4GitTool.Electron && npm run lint
```

- [ ] **Step 2: 全部测试**

```bash
cd P4GitTool.Electron && npm run test
```

Expected: Plan 1 + Plan 2 的所有测试全绿。

---

## 自检清单（规格覆盖）

| 规格要求 | 对应 Task |
|---|---|
| SSE 统一事件通道 | Task 0 + Task 1（log / files-changed / op-done） |
| `/api/events` 统一端点 | Task 1 |
| 配置读写 API | Task 2 + Task 8（保存后自动刷新 watcher） |
| 工作区查询 API（status / changes / snapshots / diff） | Task 3 |
| 写操作 API（pull / snapshot / submit） | Task 4 |
| Discard API（file / hunk / line） | Task 5 |
| Rollback API | Task 6 |
| Watcher 绑定到事件总线 | Task 7 |
| 程序退出时清理 watcher | Task 7（main.ts before-quit） |
| 多 workspace 动态监听 | Task 8 |
| 删除 stash 路由 | Task 7（未装配 stash 路由）+ Task 9（清理 stub，待前端完成） |

未覆盖项（Plan 3）：
- 前端改用 `/api/events` 统一订阅
- 前端组件与新 API 对接
- 前端删除 stash 相关代码

---

## 执行建议

本计划 12 个 Task。建议按 subagent-driven-development 执行。关键检查点：

- Task 1 完成后：用 `curl http://127.0.0.1:<port>/api/events` 手动验证 SSE 连接保持
- Task 7 完成后：本地启动 `npm run dev`，从 DevTools 的 Network 面板确认 `/api/events` 连接建立，并能收到 `files-changed` 事件（手动改一下监听目录下的文件）
- Task 9 在 Plan 3 完成后执行



