import express from 'express';
import net from 'net';
import path from 'path';
import { app as electronApp } from 'electron';
import { loadConfig, saveConfig, setConfigPath } from './services/config';
import * as ops from './services/operations';

const router = express.Router();

// SSE 日志订阅者列表
const logSubscribers = new Set<express.Response>();

function broadcast(line: string) {
  for (const res of logSubscribers) {
    res.write(`data: ${line}\n\n`);
  }
}

function makeLog() {
  return (line: string) => broadcast(line);
}

// rootDir：Electron app 数据目录
function getRootDir() {
  return electronApp.getPath('userData');
}

// -------------------------------------------------------
// SSE 日志流
// -------------------------------------------------------

router.get('/log/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  logSubscribers.add(res);
  req.on('close', () => logSubscribers.delete(res));
});

// -------------------------------------------------------
// 配置
// -------------------------------------------------------

router.get('/config', (req, res) => {
  res.json(loadConfig());
});

router.post('/config', (req, res) => {
  try {
    saveConfig(req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------
// 工作区状态
// -------------------------------------------------------

router.get('/status', async (req, res) => {
  const stream = req.query.stream as string;
  if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
  try {
    const status = await ops.getStreamStatus(getRootDir(), stream);
    res.json(status);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------
// Init
// -------------------------------------------------------

router.post('/init', async (req, res) => {
  res.json({ ok: true, message: 'started' });
  await ops.init(getRootDir(), makeLog());
});

// -------------------------------------------------------
// Pull
// -------------------------------------------------------

router.post('/pull', async (req, res) => {
  const { stream, scope = 'all', mode = 'standard' } = req.body;
  if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
  res.json({ ok: true, message: 'started' });
  await ops.pull(getRootDir(), stream, scope, mode, makeLog());
});

// -------------------------------------------------------
// 分支
// -------------------------------------------------------

router.get('/branches', async (req, res) => {
  const stream = req.query.stream as string;
  if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
  try {
    const status = await ops.getStreamStatus(getRootDir(), stream);
    res.json({ branches: status.branches, current: status.branch });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/branch', async (req, res) => {
  const { stream, name } = req.body;
  if (!stream || !name) { res.status(400).json({ error: 'stream and name required' }); return; }
  // 切换或创建分支逻辑由前端触发，这里只做简单封装
  res.json({ ok: true });
});

// -------------------------------------------------------
// 改动文件
// -------------------------------------------------------

router.get('/changes', async (req, res) => {
  const stream = req.query.stream as string;
  if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
  try {
    const files = await ops.getChangedFiles(getRootDir(), stream);
    res.json({ files });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------
// Commit（快照）
// -------------------------------------------------------

router.post('/snapshot', async (req, res) => {
  const { stream, message } = req.body;
  if (!stream || !message) { res.status(400).json({ error: 'stream and message required' }); return; }
  try {
    const ok = await ops.commitChanges(getRootDir(), stream, message, makeLog());
    res.json({ ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/snapshots', async (req, res) => {
  const stream = req.query.stream as string;
  if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
  try {
    const snapshots = await ops.getSnapshots(getRootDir(), stream);
    res.json({ snapshots });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------
// Stash
// -------------------------------------------------------

router.get('/stashes', async (req, res) => {
  const { stream, branch } = req.query as { stream: string; branch: string };
  if (!stream || !branch) { res.status(400).json({ error: 'stream and branch required' }); return; }
  try {
    const stashes = await ops.listStashes(getRootDir(), stream, branch);
    res.json({ stashes });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/stash', async (req, res) => {
  const { stream, name } = req.body;
  if (!stream || !name) { res.status(400).json({ error: 'stream and name required' }); return; }
  try {
    const ok = await ops.createStash(getRootDir(), stream, name, makeLog());
    res.json({ ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/stash/pop', async (req, res) => {
  const { stream, index } = req.body;
  if (!stream || index === undefined) { res.status(400).json({ error: 'stream and index required' }); return; }
  try {
    const ok = await ops.popStash(getRootDir(), stream, index, makeLog());
    res.json({ ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/stash/:index', async (req, res) => {
  const { stream } = req.query as { stream: string };
  const index = parseInt(req.params.index);
  if (!stream || isNaN(index)) { res.status(400).json({ error: 'stream and index required' }); return; }
  try {
    const ok = await ops.dropStash(getRootDir(), stream, index, makeLog());
    res.json({ ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------
// 提交流程
// -------------------------------------------------------

router.post('/check-update', async (req, res) => {
  const { stream } = req.body;
  if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
  res.json({ ok: true, message: 'started' });
  await ops.checkAndUpdate(getRootDir(), stream, makeLog());
});

router.post('/submit-prepare', async (req, res) => {
  const { stream } = req.body;
  if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
  res.json({ ok: true, message: 'started' });
  await ops.submitPrepare(getRootDir(), stream, makeLog());
});

router.post('/submit-confirm', async (req, res) => {
  res.json({ ok: true, message: 'started' });
  await ops.confirmSubmit(getRootDir(), makeLog());
});

// -------------------------------------------------------
// 启动服务
// -------------------------------------------------------

function getAvailablePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export async function startServer(): Promise<number> {
  const port = await getAvailablePort();
  const expressApp = express();

  expressApp.use(express.json());
  expressApp.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  expressApp.use('/api', router);

  // 初始化配置路径
  const { app: electronApp } = await import('electron');
  const configPath = path.join(electronApp.getPath('userData'), 'p4git.yaml');
  setConfigPath(configPath);

  expressApp.listen(port, '127.0.0.1');
  console.log(`[API] Server started on port ${port}`);
  return port;
}
