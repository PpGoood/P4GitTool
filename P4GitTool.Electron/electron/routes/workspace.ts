import { Router } from 'express';
import * as ops from '../services/operations';

export function createWorkspaceRouter(rootDir: string): Router {
  const router = Router();

  function requireStream(req: any, res: any): string | null {
    const stream = (req.query.stream ?? req.body?.stream) as string | undefined;
    if (!stream) { res.status(400).json({ error: 'stream required' }); return null; }
    return stream;
  }

  router.get('/status', async (req, res) => {
    const stream = requireStream(req, res); if (!stream) return;
    try { res.json(await ops.getStreamStatus(rootDir, stream)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.get('/branches', async (req, res) => {
    const stream = requireStream(req, res); if (!stream) return;
    try {
      const status = await ops.getStreamStatus(rootDir, stream);
      res.json({ branches: status.branches, current: status.branch });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.get('/changes', async (req, res) => {
    const stream = requireStream(req, res); if (!stream) return;
    try { res.json({ files: await ops.getChangedFiles(rootDir, stream) }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.get('/snapshots', async (req, res) => {
    const stream = requireStream(req, res); if (!stream) return;
    const limit = parseInt((req.query.limit as string) ?? '100', 10);
    try { res.json({ snapshots: await ops.listSnapshots(rootDir, stream, isNaN(limit) ? 100 : limit) }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.get('/diff', async (req, res) => {
    const stream = requireStream(req, res); if (!stream) return;
    const filepath = req.query.path as string;
    if (!filepath) { res.status(400).json({ error: 'path required' }); return; }
    try { res.json({ diff: await ops.getFileDiff(rootDir, stream, filepath) }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

// 兼容旧导出
export const workspaceRouter = createWorkspaceRouter('');
