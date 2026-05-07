import { Router } from 'express';
import { app as electronApp } from 'electron';
import * as ops from '../services/operations';
import { eventBus, makeLogFn } from '../services/eventBus';

export const discardRouter = Router();

function rootDir(): string {
  return electronApp.getPath('userData');
}

discardRouter.post('/discard-file', async (req, res) => {
  const { stream, path } = req.body ?? {};
  if (!stream || !path) {
    res.status(400).json({ error: 'stream and path required' });
    return;
  }
  const log = makeLogFn();
  try {
    const ok = await ops.discardFile(rootDir(), stream, path, log);
    eventBus.emit({ type: 'op-done', op: 'discard-file', stream, ok });
    res.json({ ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

discardRouter.post('/discard-hunk', async (req, res) => {
  const { stream, path, hunkIndex } = req.body ?? {};
  if (!stream || !path || hunkIndex === undefined) {
    res.status(400).json({ error: 'stream, path, hunkIndex required' });
    return;
  }
  const log = makeLogFn();
  try {
    const ok = await ops.discardHunk(rootDir(), stream, path, parseInt(hunkIndex, 10), log);
    eventBus.emit({ type: 'op-done', op: 'discard-hunk', stream, ok });
    res.json({ ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

discardRouter.post('/discard-line', async (req, res) => {
  const { stream, path, hunkIndex, lineIndex } = req.body ?? {};
  if (!stream || !path || hunkIndex === undefined || lineIndex === undefined) {
    res.status(400).json({ error: 'stream, path, hunkIndex, lineIndex required' });
    return;
  }
  const log = makeLogFn();
  try {
    const ok = await ops.discardLine(
      rootDir(), stream, path,
      parseInt(hunkIndex, 10), parseInt(lineIndex, 10),
      log
    );
    eventBus.emit({ type: 'op-done', op: 'discard-line', stream, ok });
    res.json({ ok });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
