import { Router } from 'express';
import * as ops from '../services/operations';

export function createRollbackRouter(getRootDir: () => string): Router {
  const router = Router();

  // 获取某历史节点的改动文件列表（纯读，不改变工作区）
  router.get('/node-files', async (req, res) => {
    const { stream, hash, parentHash } = req.query as Record<string, string>;
    if (!stream || !hash) { res.status(400).json({ error: 'stream and hash required' }); return; }
    try {
      const files = await ops.getNodeFiles(getRootDir(), stream, hash, parentHash ?? '');
      res.json({ files });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 获取某历史节点某文件的 diff（纯读，不改变工作区）
  router.get('/node-diff', async (req, res) => {
    const { stream, hash, parentHash, path: filepath } = req.query as Record<string, string>;
    if (!stream || !hash || !filepath) { res.status(400).json({ error: 'stream, hash, path required' }); return; }
    try {
      const diff = await ops.getNodeFileDiff(getRootDir(), stream, hash, parentHash ?? '', filepath);
      res.json({ diff });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

export const rollbackRouter = createRollbackRouter(() => '');
