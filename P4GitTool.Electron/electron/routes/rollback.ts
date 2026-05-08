import { Router } from 'express';
import * as ops from '../services/operations';
import { eventBus, makeLogFn } from '../services/eventBus';

export function createRollbackRouter(getRootDir: () => string): Router {
  const router = Router();

  router.post('/rollback', async (req, res) => {
    const { stream, hash } = req.body ?? {};
    if (!stream || !hash) { res.status(400).json({ error: 'stream and hash required' }); return; }
    try {
      const ok = await ops.rollbackTo(getRootDir(), stream, hash, makeLogFn());
      eventBus.emit({ type: 'op-done', op: 'rollback', stream, ok });
      res.json({ ok });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

export const rollbackRouter = createRollbackRouter(() => '');
