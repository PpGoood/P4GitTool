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
