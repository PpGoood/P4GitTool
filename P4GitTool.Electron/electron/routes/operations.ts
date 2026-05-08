import { Router } from 'express';
import * as ops from '../services/operations';
import { eventBus, makeLogFn } from '../services/eventBus';

function emitDone(op: string, stream: string, ok: boolean, detail?: string) {
  eventBus.emit({ type: 'op-done', op, stream, ok, detail });
}

export function createOperationsRouter(getRootDir: () => string): Router {
  const router = Router();

  router.post('/init', async (_req, res) => {
    res.json({ ok: true, message: 'started' });
    const ok = await ops.init(getRootDir(), makeLogFn());
    // init 完成后通知每个 stream 刷新
    const { loadConfig } = await import('../services/config');
    const cfg = loadConfig();
    for (const s of cfg.streams) {
      emitDone('init', s.name, ok);
    }
    if (cfg.streams.length === 0) emitDone('init', '', ok);
  });

  router.post('/pull', async (req, res) => {
    const { stream, scope = 'all', mode = 'standard' } = req.body ?? {};
    if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
    res.json({ ok: true, message: 'started' });
    const ok = await ops.pull(getRootDir(), stream, scope, mode, makeLogFn());
    emitDone('pull', stream, ok);
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

  router.post('/check-update', async (req, res) => {
    const { stream } = req.body ?? {};
    if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
    try {
      const status = await ops.checkAndUpdate(getRootDir(), stream, makeLogFn());
      emitDone('check-update', stream, status === 'ready', status);
      res.json({ status });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/submit-prepare', async (req, res) => {
    const { stream } = req.body ?? {};
    if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
    res.json({ ok: true, message: 'started' });
    const result = await ops.submitPrepare(getRootDir(), stream, makeLogFn());
    emitDone('submit-prepare', stream, result.ok, result.changelist?.toString());
  });

  router.post('/submit-confirm', async (req, res) => {
    const { stream } = req.body ?? {};
    if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
    res.json({ ok: true, message: 'started' });
    const ok = await ops.confirmSubmit(getRootDir(), stream, makeLogFn());
    emitDone('submit-confirm', stream, ok);
  });

  return router;
}

export const operationsRouter = createOperationsRouter(() => '');
