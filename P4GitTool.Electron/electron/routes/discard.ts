import { Router } from 'express';
import * as ops from '../services/operations';
import { eventBus, makeLogFn } from '../services/eventBus';

export function createDiscardRouter(getRootDir: () => string): Router {
  const router = Router();

  router.post('/discard-file', async (req, res) => {
    const { stream, path } = req.body ?? {};
    if (!stream || !path) { res.status(400).json({ error: 'stream and path required' }); return; }
    try {
      const ok = await ops.discardFile(getRootDir(), stream, path, makeLogFn());
      eventBus.emit({ type: 'op-done', op: 'discard-file', stream, ok });
      res.json({ ok });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/discard-hunk', async (req, res) => {
    const { stream, path, hunkIndex } = req.body ?? {};
    if (!stream || !path || hunkIndex === undefined) { res.status(400).json({ error: 'stream, path, hunkIndex required' }); return; }
    try {
      const ok = await ops.discardHunk(getRootDir(), stream, path, parseInt(hunkIndex, 10), makeLogFn());
      eventBus.emit({ type: 'op-done', op: 'discard-hunk', stream, ok });
      res.json({ ok });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/discard-line', async (req, res) => {
    const { stream, path, hunkIndex, lineIndex } = req.body ?? {};
    if (!stream || !path || hunkIndex === undefined || lineIndex === undefined) { res.status(400).json({ error: 'stream, path, hunkIndex, lineIndex required' }); return; }
    try {
      const ok = await ops.discardLine(getRootDir(), stream, path, parseInt(hunkIndex, 10), parseInt(lineIndex, 10), makeLogFn());
      eventBus.emit({ type: 'op-done', op: 'discard-line', stream, ok });
      res.json({ ok });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

export const discardRouter = createDiscardRouter(() => '');
