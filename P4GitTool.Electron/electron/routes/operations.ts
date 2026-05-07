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
