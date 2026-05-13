import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { run } from './runner';

/**
 * listSnapshots 集成测试
 * 验证：
 * - 新的 --name-only 切块格式能正确解析 fileCount
 * - tag 映射到正确的 kind（submit / sync / manual）
 * - 结果按时间正序（最新在末尾）
 */
describe('listSnapshots (integration)', () => {
  let rootDir: string;
  let repo: string;

  async function setupRepo() {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4git-snap-'));
    repo = path.join(rootDir, 'ProjectX_dev_git');
    fs.mkdirSync(repo, { recursive: true });

    await run('git', ['init', '-b', 'mirror/p4'], repo, true);
    await run('git', ['config', 'user.email', 'test@test'], repo, true);
    await run('git', ['config', 'user.name', 'Test'], repo, true);
    await run('git', ['config', 'core.autocrlf', 'false'], repo, true);

    // init commit
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

  it('fileCount 正确统计每个 commit 的改动文件数', async () => {
    // commit 1：改动 2 个文件
    fs.writeFileSync(path.join(repo, 'Source', 'b.cpp'), 'int b = 2;\n');
    fs.writeFileSync(path.join(repo, 'Source', 'c.cpp'), 'int c = 3;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'manual: add b and c'], repo, true);

    // commit 2：改动 1 个文件
    fs.writeFileSync(path.join(repo, 'Source', 'd.cpp'), 'int d = 4;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'manual: add d'], repo, true);

    const { listSnapshots } = await import('./snapshot');
    const snapshots = await listSnapshots(rootDir, 'dev', 10);

    // 最新在末尾
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    const last = snapshots[snapshots.length - 1];
    const prev = snapshots[snapshots.length - 2];

    expect(last.fileCount).toBe(1);   // commit 2：1 个文件
    expect(prev.fileCount).toBe(2);   // commit 1：2 个文件
  });

  it('p4-submit tag 映射到 submit kind', async () => {
    fs.writeFileSync(path.join(repo, 'Source', 'e.cpp'), 'int e = 5;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'feat: add e'], repo, true);
    await run('git', ['tag', 'p4-submit-20240101-1200'], repo, true);

    const { listSnapshots } = await import('./snapshot');
    const snapshots = await listSnapshots(rootDir, 'dev', 10);

    const tagged = snapshots.find(s => s.kind === 'submit');
    expect(tagged).toBeDefined();
  });

  it('p4-sync tag 映射到 sync kind', async () => {
    fs.writeFileSync(path.join(repo, 'Source', 'f.cpp'), 'int f = 6;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'sync: P4 dev all'], repo, true);
    await run('git', ['tag', 'p4-sync-20240101-1300'], repo, true);

    const { listSnapshots } = await import('./snapshot');
    const snapshots = await listSnapshots(rootDir, 'dev', 10);

    const tagged = snapshots.find(s => s.kind === 'sync');
    expect(tagged).toBeDefined();
  });

  it('无 tag 的普通 commit 映射到 manual kind', async () => {
    fs.writeFileSync(path.join(repo, 'Source', 'g.cpp'), 'int g = 7;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', '武器伤害调整'], repo, true);

    const { listSnapshots } = await import('./snapshot');
    const snapshots = await listSnapshots(rootDir, 'dev', 10);

    const manual = snapshots.find(s => s.message === '武器伤害调整');
    expect(manual?.kind).toBe('manual');
  });

  it('结果按时间正序，最新在末尾', async () => {
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(repo, 'Source', `x${i}.cpp`), `int x${i} = ${i};\n`);
      await run('git', ['add', '.'], repo, true);
      await run('git', ['commit', '-m', `commit ${i}`], repo, true);
    }

    const { listSnapshots } = await import('./snapshot');
    const snapshots = await listSnapshots(rootDir, 'dev', 10);

    // 最后一个应该是最新的 commit
    const last = snapshots[snapshots.length - 1];
    expect(last.message).toBe('commit 2');
  });
});
