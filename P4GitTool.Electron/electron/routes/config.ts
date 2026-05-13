import { Router } from 'express';
import { loadConfig, saveConfig } from '../services/config';

export type ConfigChangedHandler = () => Promise<void> | void;

export function createConfigRouter(onChanged?: ConfigChangedHandler): Router {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.json(loadConfig());
  });

  router.post('/config', async (req, res) => {
    try {
      saveConfig(req.body);
      if (onChanged) await onChanged();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
