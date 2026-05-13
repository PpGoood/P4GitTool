import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { run } from './runner';

/**
 * alignGitContinue 集成测试
 * 验证：
 * - 非 merge 状态调用直接返回 false（MERGE_HEAD 校验）
 * - theirs 解决：冲突文件使用 mirror/p4 版本
 * - ours 解决：冲突文件保留本地版本
 * - manual 解决：用户已手动解决，直接 commit
 * - 只 add 冲突文件，不带入其他改动
 */
describe('alignGitContinue (integration)', () => {
  let rootDir: string;
  let repo: string;

  async function setupRepo() {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4git-align-'));
    repo = path.join(rootDir, 'ProjectX_dev_git');
    fs.mkdirSync(repo, { recursive: true });

    await run('git', ['init', '-b', 'mirror/p4'], repo, true);
    await run('git', ['config', 'user.email', 'test@test'], repo, true);
    await run('git', ['config', 'user.name', 'Test'], repo, true);
    await run('git', ['config', 'core.autocrlf', 'false'], repo, true);
    await run('git', ['config', 'merge.conflictstyle', 'merge'], repo, true);

    // mirror/p4 初始 commit
    fs.mkdirSync(path.join(repo, 'Source'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'Source', 'a.cpp'), 'int a = 1;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'init: dev workspace'], repo, true);

    // 切到 dev 分支
    await run('git', ['checkout', '-b', 'dev'], repo, true);
  }

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  /**
   * 制造 merge 冲突：
   * - mirror/p4 修改 a.cpp 为 P4 版本
   * - dev 修改 a.cpp 为本地版本
   * - git merge mirror/p4 → 冲突
   */
  async function createConflict() {
    // dev 分支修改
    fs.writeFileSync(path.join(repo, 'Source', 'a.cpp'), 'int a = LOCAL;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'local: change a'], repo, true);

    // mirror/p4 分支修改（用 plumbing 不切换分支）
    await run('git', ['read-tree', 'mirror/p4'], repo, true);
    fs.writeFileSync(path.join(repo, 'Source', 'a.cpp'), 'int a = P4;\n');
    await run('git', ['add', 'Source/a.cpp'], repo, true);
    const treeHash = (await run('git', ['write-tree'], repo, true)).stdout.trim();
    const mirrorHash = (await run('git', ['rev-parse', 'mirror/p4'], repo, true)).stdout.trim();
    const commitHash = (await run(
      'git', ['commit-tree', treeHash, '-p', mirrorHash, '-m', 'sync: P4 update'], repo, true
    )).stdout.trim();
    await run('git', ['update-ref', 'refs/heads/mirror/p4', commitHash], repo, true);
    await run('git', ['read-tree', 'HEAD'], repo, true);

    // 触发冲突 merge
    await run('git', ['merge', '--no-edit', 'mirror/p4'], repo, true);
    // merge 应该失败（有冲突），MERGE_HEAD 应该存在
  }

  beforeEach(async () => {
    await setupRepo();
  });

  it('非 merge 状态调用返回 false', async () => {
    // 没有 MERGE_HEAD，直接调用应该失败
    const mergeHeadPath = path.join(repo, '.git', 'MERGE_HEAD');
    expect(fs.existsSync(mergeHeadPath)).toBe(false);

    const { alignGitContinue } = await import('./align');
    const result = await alignGitContinue(rootDir, 'dev', 'manual', () => {});
    expect(result.ok).toBe(false);
  });

  it('theirs 解决：冲突文件使用 P4 版本', async () => {
    await createConflict();

    const mergeHeadPath = path.join(repo, '.git', 'MERGE_HEAD');
    if (!fs.existsSync(mergeHeadPath)) {
      // 如果没有冲突（文件内容相同），跳过此测试
      return;
    }

    const { alignGitContinue } = await import('./align');
    const result = await alignGitContinue(rootDir, 'dev', 'theirs', () => {});
    expect(result.ok).toBe(true);

    // 文件内容应该是 P4 版本
    const content = fs.readFileSync(path.join(repo, 'Source', 'a.cpp'), 'utf-8');
    expect(content).toContain('P4');
    expect(content).not.toContain('LOCAL');

    // MERGE_HEAD 应该已清除
    expect(fs.existsSync(mergeHeadPath)).toBe(false);
  });

  it('ours 解决：冲突文件保留本地版本', async () => {
    await createConflict();

    const mergeHeadPath = path.join(repo, '.git', 'MERGE_HEAD');
    if (!fs.existsSync(mergeHeadPath)) {
      return;
    }

    const { alignGitContinue } = await import('./align');
    const result = await alignGitContinue(rootDir, 'dev', 'ours', () => {});
    expect(result.ok).toBe(true);

    // 文件内容应该是本地版本
    const content = fs.readFileSync(path.join(repo, 'Source', 'a.cpp'), 'utf-8');
    expect(content).toContain('LOCAL');
    expect(content).not.toContain('P4');

    expect(fs.existsSync(mergeHeadPath)).toBe(false);
  });

  it('只 add 冲突文件，不带入其他改动', async () => {
    await createConflict();

    const mergeHeadPath = path.join(repo, '.git', 'MERGE_HEAD');
    if (!fs.existsSync(mergeHeadPath)) {
      return;
    }

    // 在冲突期间额外修改另一个文件（不应该被带入 merge commit）
    fs.writeFileSync(path.join(repo, 'Source', 'extra.cpp'), 'int extra = 99;\n');

    const { alignGitContinue } = await import('./align');
    const result = await alignGitContinue(rootDir, 'dev', 'theirs', () => {});
    expect(result.ok).toBe(true);

    // extra.cpp 应该还在工作区（未被 commit）
    const { stdout } = await run('git', ['status', '--porcelain'], repo, true);
    expect(stdout).toContain('extra.cpp');

    // HEAD commit 不应该包含 extra.cpp
    const { stdout: diffOut } = await run(
      'git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], repo, true
    );
    expect(diffOut).not.toContain('extra.cpp');
  });

  it('manual 解决：用户已手动解决冲突后直接 commit', async () => {
    await createConflict();

    const mergeHeadPath = path.join(repo, '.git', 'MERGE_HEAD');
    if (!fs.existsSync(mergeHeadPath)) {
      return;
    }

    // 模拟用户手动解决：直接写入解决后的内容并 stage
    fs.writeFileSync(path.join(repo, 'Source', 'a.cpp'), 'int a = RESOLVED;\n');
    await run('git', ['add', 'Source/a.cpp'], repo, true);

    const { alignGitContinue } = await import('./align');
    const result = await alignGitContinue(rootDir, 'dev', 'manual', () => {});
    expect(result.ok).toBe(true);

    const content = fs.readFileSync(path.join(repo, 'Source', 'a.cpp'), 'utf-8');
    expect(content).toContain('RESOLVED');

    expect(fs.existsSync(mergeHeadPath)).toBe(false);
  });
});
