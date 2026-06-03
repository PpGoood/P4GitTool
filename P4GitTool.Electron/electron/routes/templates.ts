import { Router } from 'express';
import { spawn } from 'child_process';
import * as tpl from '../services/templates';

export function createTemplatesRouter(getRootDir: () => string): Router {
  const router = Router();

  // 在资源管理器打开模板目录
  router.post('/open-templates-dir', (_req, res) => {
    try {
      const dir = tpl.templatesDir(getRootDir());
      tpl.ensureTemplates(getRootDir());
      const proc = spawn('explorer', [dir], { detached: true, stdio: 'ignore' });
      proc.unref();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 读取所有模板 + 技能 + 同步状态
  router.get('/templates', (_req, res) => {
    try {
      const rootDir = getRootDir();
      res.json({
        templates: tpl.readAllTemplates(rootDir),
        skills: tpl.listSkills(rootDir),
        status: tpl.syncStatus(rootDir),
        templatesDir: tpl.templatesDir(rootDir),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 保存单个模板
  router.post('/templates', (req, res) => {
    const { kind, content } = req.body ?? {};
    if (!kind || content === undefined) {
      res.status(400).json({ error: 'kind and content required' }); return;
    }
    try {
      tpl.writeTemplate(getRootDir(), kind, content);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 保存技能
  router.post('/skills', (req, res) => {
    const { name, content } = req.body ?? {};
    if (!name || content === undefined) {
      res.status(400).json({ error: 'name and content required' }); return;
    }
    try {
      tpl.writeSkill(getRootDir(), name, content);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 删除技能
  router.post('/skills/delete', (req, res) => {
    const { name } = req.body ?? {};
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    try {
      tpl.deleteSkill(getRootDir(), name);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 同步配置到工作区（可指定 stream，不传则全部）
  router.post('/sync-config', (req, res) => {
    const { stream } = req.body ?? {};
    try {
      const results = tpl.syncConfig(getRootDir(), stream);
      res.json({ ok: results.every(r => r.ok), results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
