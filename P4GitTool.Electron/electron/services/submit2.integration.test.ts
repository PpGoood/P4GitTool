import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { run } from './runner';
import { setConfigPath } from './config';

/**
 * submitPrepare 集成测试（git 侧逻辑，不依赖 P4）
 * 验证：
 * - 工作区有未提交改动时拒绝（dirty-workspace）
 * - 工作区干净但无候选文件时返回 no-changes
 * - 有候选文件时 buildCandidates 正确返回
 */
describe('submitPrepare git-side (integration)', () => {
  let rootDir: string;
  let repo: string;

  async function setupRepo() {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4git-submit2-'));
    repo = path.join(rootDir, 'ProjectX_dev_git');
    const p4Root = path.join(rootDir, 'p4workspace');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(path.join(p4Root, 'ProjectX', 'Source'), { recursive: true });

    const configPath = path.join(rootDir, 'p4git.yaml');
    fs.writeFileSync(configPath, yaml.dump({
      p4_port: 'localhost:1666',
      p4_user: 'test',
      workspaces_dir: rootDir,
      streams: [{ name: 'dev', client: 'test-dev', root: p4Root }],
    }));
    setConfigPath(configPath);

    await run('git', ['init', '-b', 'mirror/p4'], repo, true);
    await run('git', ['config', 'user.email', 'test@test'], repo, true);
    await run('git', ['config', 'user.name', 'Test'], repo, true);
    await run('git', ['config', 'core.autocrlf', 'false'], repo, true);

    fs.mkdirSync(path.join(repo, 'Source'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'Source', 'a.cpp'), 'int a = 1;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'init: dev workspace'], repo, true);
    await run('git', ['checkout', '-b', 'dev'], repo, true);
  }

  beforeEach(setupRepo);

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('工作区有未提交改动时 gitCheckClean 返回 false', async () => {
    // 制造未提交改动
    fs.writeFileSync(path.join(repo, 'Source', 'dirty.cpp'), 'int dirty = 1;\n');

    const { gitCheckClean } = await import('./git');
    const clean = await gitCheckClean(repo);
    expect(clean).toBe(false);
  });

  it('工作区干净时 gitCheckClean 返回 true', async () => {
    const { gitCheckClean } = await import('./git');
    const clean = await gitCheckClean(repo);
    expect(clean).toBe(true);
  });

  it('有 p4-submit tag 后新增文件，buildCandidates 只返回新增文件', async () => {
    // 打 tag 作为基准
    await run('git', ['tag', 'p4-submit-20240101-1200'], repo, true);

    // 新增文件并提交
    fs.writeFileSync(path.join(repo, 'Source', 'new.cpp'), 'int new_fn = 1;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'feat: add new.cpp'], repo, true);

    const { buildCandidates } = await import('./submit');
    const candidates = await buildCandidates(rootDir, 'dev');

    expect(candidates.some(c => c.includes('new.cpp'))).toBe(true);
    expect(candidates.some(c => c.includes('a.cpp'))).toBe(false);
  });

  it('init: commit 之后无新提交时 buildCandidates 返回空', async () => {
    // 没有 tag，init: commit 是基准，HEAD 就是 init commit，diff 为空
    const { buildCandidates } = await import('./submit');
    const candidates = await buildCandidates(rootDir, 'dev');

    // init: commit 是基准，HEAD == 基准，diff 为空
    expect(candidates).toHaveLength(0);
  });

  it('Content/Script 路径的文件也被包含在候选中', async () => {
    await run('git', ['tag', 'p4-submit-20240101-1200'], repo, true);

    // 新增 Content/Script 下的文件
    fs.mkdirSync(path.join(repo, 'Content', 'Script'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'Content', 'Script', 'test.lua'), 'local x = 1\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'feat: add lua script'], repo, true);

    const { buildCandidates } = await import('./submit');
    const candidates = await buildCandidates(rootDir, 'dev');

    expect(candidates.some(c => c.includes('test.lua'))).toBe(true);
  });
});
