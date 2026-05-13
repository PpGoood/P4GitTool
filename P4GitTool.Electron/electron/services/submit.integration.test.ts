import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { run } from './runner';
import { setConfigPath } from './config';

/**
 * buildCandidates 集成测试
 * 不依赖 P4，只测 git 逻辑：
 * - 有 p4-submit tag 时从 tag 到 HEAD 的 diff
 * - 没有 tag 时降级用 mirror/p4
 * - tag 正则严格匹配（手工 tag 不被误认）
 */
describe('buildCandidates (integration)', () => {
  let rootDir: string;
  let repo: string;
  let p4Root: string;

  async function setupRepo() {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4git-submit-'));
    repo = path.join(rootDir, 'ProjectX_dev_git');
    // p4Root 模拟 P4 工作区根目录（buildCandidates 用它拼绝对路径）
    p4Root = path.join(rootDir, 'p4workspace');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(path.join(p4Root, 'ProjectX', 'Source'), { recursive: true });

    // 写临时配置文件，让 loadConfig / getStream 能找到 stream
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

    // 初始 commit（mirror/p4 分支）
    fs.mkdirSync(path.join(repo, 'Source'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'Source', 'a.cpp'), 'int a = 1;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'init: dev workspace'], repo, true);

    // 切到 dev 分支
    await run('git', ['checkout', '-b', 'dev'], repo, true);
  }

  beforeEach(setupRepo);

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('有 p4-submit tag 时只返回 tag 之后的改动文件', async () => {
    // 打 p4-submit tag（模拟上次提交点）
    await run('git', ['tag', 'p4-submit-20240101-1200'], repo, true);

    // 在 tag 之后新增一个文件
    fs.writeFileSync(path.join(repo, 'Source', 'b.cpp'), 'int b = 2;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'feat: add b.cpp'], repo, true);

    const { buildCandidates } = await import('./submit');
    const candidates = await buildCandidates(rootDir, 'dev');

    // 应该只包含 b.cpp，不包含 a.cpp（a.cpp 在 tag 之前）
    expect(candidates.some(c => c.includes('b.cpp'))).toBe(true);
    expect(candidates.some(c => c.includes('a.cpp'))).toBe(false);
  });

  it('手工 tag（不符合格式）不被当作基准', async () => {
    // 打一个不符合 p4-(submit|sync)-YYYYMMDD-HHMM 格式的 tag
    await run('git', ['tag', 'p4-submit-test'], repo, true);
    await run('git', ['tag', 'p4-submit-backup'], repo, true);

    // 新增文件
    fs.writeFileSync(path.join(repo, 'Source', 'c.cpp'), 'int c = 3;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'feat: add c.cpp'], repo, true);

    const { buildCandidates } = await import('./submit');
    const candidates = await buildCandidates(rootDir, 'dev');

    // 没有合法 tag，降级用 mirror/p4，应该包含 c.cpp（相对 mirror/p4 是新增）
    expect(candidates.some(c => c.includes('c.cpp'))).toBe(true);
  });

  it('init: commit 可以作为基准', async () => {
    // 没有 p4-submit tag，但有 init: commit message
    // init commit 已经在 setupRepo 里创建了

    // 在 init 之后新增文件
    fs.writeFileSync(path.join(repo, 'Source', 'd.cpp'), 'int d = 4;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'feat: add d.cpp'], repo, true);

    const { buildCandidates } = await import('./submit');
    const candidates = await buildCandidates(rootDir, 'dev');

    // init: commit 是基准，d.cpp 在它之后，应该被包含
    expect(candidates.some(c => c.includes('d.cpp'))).toBe(true);
    // a.cpp 在 init: commit 里，不应该被包含
    expect(candidates.some(c => c.includes('a.cpp'))).toBe(false);
  });
});
