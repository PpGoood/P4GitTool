import { Router } from 'express';
import { app as electronApp } from 'electron';
import * as ops from '../services/operations';

export const workspaceRouter = Router();

function rootDir(): string {
  return electronApp.getPath('userData');
}

function requireStream(req: any, res: any): string | null {
  const stream = (req.query.stream ?? req.body?.stream) as string | undefined;
  if (!stream) {
    res.status(400).json({ error: 'stream required' });
    return null;
  }
  return stream;
}

workspaceRouter.get('/status', async (req, res) => {
  const stream = requireStream(req, res); if (!stream) return;
  try {
    const status = await ops.getStreamStatus(rootDir(), stream);
    res.json(status);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

workspaceRouter.get('/branches', async (req, res) => {
  const stream = requireStream(req, res); if (!stream) return;
  try {
    const status = await ops.getStreamStatus(rootDir(), stream);
    res.json({ branches: status.branches, current: status.branch });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

workspaceRouter.get('/changes', async (req, res) => {
  const stream = requireStream(req, res); if (!stream) return;
  try {
    const files = await ops.getChangedFiles(rootDir(), stream);
    res.json({ files });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

workspaceRouter.get('/snapshots', async (req, res) => {
  const stream = requireStream(req, res); if (!stream) return;
  const limit = parseInt((req.query.limit as string) ?? '100', 10);
  try {
    const snapshots = await ops.listSnapshots(rootDir(), stream, isNaN(limit) ? 100 : limit);
    res.json({ snapshots });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

workspaceRouter.get('/diff', async (req, res) => {
  const stream = requireStream(req, res); if (!stream) return;
  const filepath = req.query.path as string;
  if (!filepath) { res.status(400).json({ error: 'path required' }); return; }
  try {
    const diff = await ops.getFileDiff(rootDir(), stream, filepath);
    res.json({ diff });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
