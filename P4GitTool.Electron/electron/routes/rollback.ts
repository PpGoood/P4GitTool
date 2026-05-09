import { Router } from 'express';
import * as ops from '../services/operations';
import { eventBus, makeLogFn } from '../services/eventBus';

export function createRollbackRouter(getRootDir: () => string): Router {
  const router = Router();

  // 查看历史节点（detached HEAD）
  router.post('/checkout-node', async (req, res) => {
    const { stream, hash } = req.body ?? {};
    if (!stream || !hash) { res.status(400).json({ error: 'stream and hash required' }); return; }
    try {
      const ok = await ops.checkoutHistoryNode(getRootDir(), stream, hash, makeLogFn());
      eventBus.emit({ type: 'op-done', op: 'checkout-node', stream, ok });
      res.json({ ok });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 回到最新工作分支
  router.post('/return-latest', async (req, res) => {
    const { stream } = req.body ?? {};
    if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
    try {
      const ok = await ops.returnToLatest(getRootDir(), stream, makeLogFn());
      eventBus.emit({ type: 'op-done', op: 'return-latest', stream, ok });
      res.json({ ok });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 保留旧的 rollback 路由兼容
  router.post('/rollback', async (req, res) => {
    const { stream, hash } = req.body ?? {};
    if (!stream || !hash) { res.status(400).json({ error: 'stream and hash required' }); return; }
    try {
      const ok = await ops.checkoutHistoryNode(getRootDir(), stream, hash, makeLogFn());
      eventBus.emit({ type: 'op-done', op: 'rollback', stream, ok });
      res.json({ ok });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

export const rollbackRouter = createRollbackRouter(() => '');
