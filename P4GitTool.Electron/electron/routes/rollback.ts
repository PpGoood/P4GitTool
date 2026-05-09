import { Router } from 'express';
import * as ops from '../services/operations';
import { eventBus, makeLogFn } from '../services/eventBus';

export function createRollbackRouter(getRootDir: () => string): Router {
  const router = Router();

  // 获取某历史节点的改动文件列表（纯读）
  router.get('/node-files', async (req, res) => {
    const { stream, hash, parentHash } = req.query as Record<string, string>;
    if (!stream || !hash) { res.status(400).json({ error: 'stream and hash required' }); return; }
    try {
      const files = await ops.getNodeFiles(getRootDir(), stream, hash, parentHash ?? '');
      res.json({ files });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 获取某历史节点某文件的 diff（纯读）
  router.get('/node-diff', async (req, res) => {
    const { stream, hash, parentHash, path: filepath } = req.query as Record<string, string>;
    if (!stream || !hash || !filepath) { res.status(400).json({ error: 'stream, hash, path required' }); return; }
    try {
      const diff = await ops.getNodeFileDiff(getRootDir(), stream, hash, parentHash ?? '', filepath);
      res.json({ diff });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Checkout 到历史节点（detached HEAD，用于验证问题）
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

  return router;
}

export const rollbackRouter = createRollbackRouter(() => '');
