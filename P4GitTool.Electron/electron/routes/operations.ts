import { Router } from 'express';
import { spawn } from 'child_process';
import * as ops from '../services/operations';
import { eventBus, makeLogFn } from '../services/eventBus';
import { loadConfig, getStream, repoPath } from '../services/config';

function emitDone(op: string, stream: string, ok: boolean, detail?: string) {
  eventBus.emit({ type: 'op-done', op, stream, ok, detail });
}

export function createOperationsRouter(getRootDir: () => string): Router {
  const router = Router();

  router.post('/init', async (_req, res) => {
    // 同步等待 init 完成再返回，前端 isLoading 才能正确覆盖整个过程
    const ok = await ops.init(getRootDir(), makeLogFn());
    // 通知每个 stream 刷新
    const cfg = loadConfig();
    for (const s of cfg.streams) {
      emitDone('init', s.name, ok);
    }
    if (cfg.streams.length === 0) emitDone('init', '', ok);
    res.json({ ok });
  });

  router.post('/pull', async (req, res) => {
    const { stream, scope = 'all', mode = 'standard' } = req.body ?? {};
    if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
    const ok = await ops.pull(getRootDir(), stream, scope, mode, makeLogFn());
    emitDone('pull', stream, ok);
    res.json({ ok });
  });

  router.post('/snapshot', async (req, res) => {
    const { stream, message } = req.body ?? {};
    if (!stream || !message) { res.status(400).json({ error: 'stream and message required' }); return; }
    try {
      const ok = await ops.commitSnapshot(getRootDir(), stream, message, makeLogFn());
      emitDone('snapshot', stream, ok);
      res.json({ ok });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/align-git', async (req, res) => {
    const { stream } = req.body ?? {};
    if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
    try {
      const result = await ops.alignGit(getRootDir(), stream, makeLogFn());
      emitDone('align-git', stream, result.ok);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/align-git-continue', async (req, res) => {
    const { stream, resolution } = req.body ?? {};
    if (!stream || !resolution) { res.status(400).json({ error: 'stream and resolution required' }); return; }
    try {
      const result = await ops.alignGitContinue(getRootDir(), stream, resolution, makeLogFn());
      emitDone('align-git', stream, result.ok);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/submit-prepare', async (req, res) => {
    const { stream } = req.body ?? {};
    if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
    try {
      // 同步等待完成再返回，前端能看到结果
      const result = await ops.submitPrepare(getRootDir(), stream, makeLogFn());
      emitDone('submit-prepare', stream, result.ok, result.changelist?.toString());
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/open-in-vscode', async (req, res) => {
    const { stream, filepath } = req.body ?? {};
    if (!stream || !filepath) { res.status(400).json({ error: 'stream and filepath required' }); return; }
    const cfg = loadConfig();
    const sc = getStream(cfg, stream);
    if (!sc) { res.status(400).json({ error: `stream ${stream} not found` }); return; }
    const projectRoot = sc.root + '/ProjectX';
    const fullPath = projectRoot + '/' + filepath;
    const proc = spawn('code', ['--goto', fullPath], { detached: true, stdio: 'ignore', shell: true });
    proc.unref();
    res.json({ ok: true });
  });

  // 在新终端窗口里、对应 git 工作区下打开 claude -r（恢复历史对话，交互式选择）
  router.post('/open-claude', async (req, res) => {
    const { stream } = req.body ?? {};
    if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
    const repo = repoPath(getRootDir(), stream);
    // start 拉起新 cmd 窗口，cd 到工作区后跑 claude -r；/k 保持窗口打开供交互
    // 窗口标题用 "P4Git Claude - <stream>"
    const proc = spawn(
      'cmd',
      ['/c', 'start', `P4Git Claude - ${stream}`, 'cmd', '/k', `cd /d "${repo}" && claude -r`],
      { detached: true, stdio: 'ignore', windowsHide: false }
    );
    proc.unref();
    res.json({ ok: true });
  });

  return router;
}
