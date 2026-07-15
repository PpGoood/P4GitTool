import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { run } from './runner';
import { setConfigPath } from './config';
import { discardFile, discardHunk, discardLine } from './discard';

/**
 * discardFile 集成测试
 * 验证"还原到上个快照(HEAD)"的正确行为：
 * - 已修改文件 → 恢复到 HEAD 内容，且不留在暂存区
 * - 新增(未跟踪)文件 → 还原 = 删除
 * - 已删除文件 → 恢复回来
 */
describe('discardFile 还原到上个快照 (integration)', () => {
  let rootDir: string;
  let repo: string;

  beforeEach(async () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4git-discard-'));
    repo = path.join(rootDir, 'ProjectX_dev_git');
    fs.mkdirSync(path.join(repo, 'Source'), { recursive: true });

    // mirror/p4 = 更早的 P4 版本；dev = 上个快照
    await run('git', ['init', '-b', 'mirror/p4'], repo, true);
    await run('git', ['config', 'user.email', 't@t'], repo, true);
    await run('git', ['config', 'user.name', 't'], repo, true);
    await run('git', ['config', 'core.autocrlf', 'false'], repo, true);
    fs.writeFileSync(path.join(repo, 'Source', 'f.cpp'), 'v1-p4\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'p4 base'], repo, true);

    await run('git', ['checkout', '-b', 'dev'], repo, true);
    fs.writeFileSync(path.join(repo, 'Source', 'f.cpp'), 'v2-snapshot\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'dev snapshot'], repo, true);

    const cfgPath = path.join(rootDir, 'config.yaml');
    fs.writeFileSync(
      cfgPath,
      `p4_port: ""\np4_user: ""\nworkspaces_dir: "${rootDir.replace(/\\/g, '/')}"\nstreams:\n  - name: dev\n    client: c\n    root: "${rootDir.replace(/\\/g, '/')}"\n`
    );
    setConfigPath(cfgPath);
  });

  afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  async function porcelain(): Promise<string> {
    const { stdout } = await run('git', ['status', '--porcelain'], repo, true);
    return stdout;
  }

  it('已修改文件：还原到上个快照内容，且不留在暂存区', async () => {
    fs.writeFileSync(path.join(repo, 'Source', 'f.cpp'), 'v3-working\n');

    const ok = await discardFile(rootDir, 'dev', 'Source/f.cpp', () => {});
    expect(ok).toBe(true);

    // 内容恢复到上个快照 v2（不是 mirror/p4 的 v1）
    expect(fs.readFileSync(path.join(repo, 'Source', 'f.cpp'), 'utf-8')).toBe('v2-snapshot\n');
    // 工作区干净：没有残留 staged / unstaged
    expect((await porcelain()).trim()).toBe('');
  });

  it('新增未跟踪文件：还原 = 删除', async () => {
    fs.writeFileSync(path.join(repo, 'Source', 'new.cpp'), 'brand new\n');

    const ok = await discardFile(rootDir, 'dev', 'Source/new.cpp', () => {});
    expect(ok).toBe(true);

    expect(fs.existsSync(path.join(repo, 'Source', 'new.cpp'))).toBe(false);
    expect((await porcelain()).trim()).toBe('');
  });

  it('已 add 的新增文件：还原 = 删除且清出暂存区', async () => {
    fs.writeFileSync(path.join(repo, 'Source', 'staged.cpp'), 'staged new\n');
    await run('git', ['add', 'Source/staged.cpp'], repo, true);

    const ok = await discardFile(rootDir, 'dev', 'Source/staged.cpp', () => {});
    expect(ok).toBe(true);

    expect(fs.existsSync(path.join(repo, 'Source', 'staged.cpp'))).toBe(false);
    expect((await porcelain()).trim()).toBe('');
  });

  it('已删除文件：还原恢复回来', async () => {
    fs.rmSync(path.join(repo, 'Source', 'f.cpp'));

    const ok = await discardFile(rootDir, 'dev', 'Source/f.cpp', () => {});
    expect(ok).toBe(true);

    expect(fs.readFileSync(path.join(repo, 'Source', 'f.cpp'), 'utf-8')).toBe('v2-snapshot\n');
    expect((await porcelain()).trim()).toBe('');
  });
});

/**
 * hunk/line 撤销：当前 repo 在 beforeEach 是 mirror/p4=v1, dev=v2 (Hunk 1)，
 * 工作区再 v3 = v2 + 增/改 hunk。撤销后回退到 v2。
 */
describe('discardHunk / discardLine (integration)', () => {
  let rootDir: string;
  let repo: string;

  beforeEach(async () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4git-discard-hunk-'));
    repo = path.join(rootDir, 'ProjectX_dev_git');
    fs.mkdirSync(path.join(repo, 'Source'), { recursive: true });

    // mirror/p4 = P4 基线（v1）
    await run('git', ['init', '-b', 'mirror/p4'], repo, true);
    await run('git', ['config', 'user.email', 't@t'], repo, true);
    await run('git', ['config', 'user.name', 't'], repo, true);
    await run('git', ['config', 'core.autocrlf', 'false'], repo, true);
    fs.writeFileSync(path.join(repo, 'Source', 'f.cpp'),
      'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'p4 base'], repo, true);

    // dev = 上个快照（v2）：Hunk 1：把 line 3 改成 "line 3 MODIFIED"
    await run('git', ['checkout', '-b', 'dev'], repo, true);
    fs.writeFileSync(path.join(repo, 'Source', 'f.cpp'),
      'line 1\nline 2\nline 3 MODIFIED\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'dev snapshot'], repo, true);

    // 工作区（v3）：追加一行 Hunk 2（line 6 之后插入"line 6b inserted"）
    const content = fs.readFileSync(path.join(repo, 'Source', 'f.cpp'), 'utf-8').split('\n');
    content.splice(5, 0, 'line 6b inserted');  // 插入到 line 6 之后
    fs.writeFileSync(path.join(repo, 'Source', 'f.cpp'), content.join('\n'));

    // 此时 diff HEAD 有 1 个 hunk（Hunk 2：line 6b inserted），diff mirror/p4 有 2 个 hunk
    // discard 的正确实现应与前端 diff HEAD 保持一致

    const cfgPath = path.join(rootDir, 'config.yaml');
    fs.writeFileSync(
      cfgPath,
      `p4_port: ""\np4_user: ""\nworkspaces_dir: "${rootDir.replace(/\\/g, '/')}"\nstreams:\n  - name: dev\n    client: c\n    root: "${rootDir.replace(/\\/g, '/')}"\n`
    );
    setConfigPath(cfgPath);
  });

  afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  it('discardHunk(0) 撤销工作区中唯一的 hunk（与 diff HEAD 一致）', async () => {
    // 撤销前文件包含 "line 6b inserted"
    let content = fs.readFileSync(path.join(repo, 'Source', 'f.cpp'), 'utf-8');
    expect(content).toContain('line 6b inserted');

    const ok = await discardHunk(rootDir, 'dev', 'Source/f.cpp', 0, () => {});
    expect(ok).toBe(true);

    // 撤销后：line 6b inserted 应消失，工作区回退到 v2 (dev HEAD) 状态
    content = fs.readFileSync(path.join(repo, 'Source', 'f.cpp'), 'utf-8');
    expect(content).not.toContain('line 6b inserted');
    expect(content).toContain('line 3 MODIFIED');  // Hunk 1 不动
  });

  it('discardHunk(0) 撤销后 diff mirror/p4 仍存在（Hunk 1 来自 dev commit，不应被撤销）', async () => {
    const ok = await discardHunk(rootDir, 'dev', 'Source/f.cpp', 0, () => {});
    expect(ok).toBe(true);

    // diff mirror/p4 应仍有 Hunk 1（line 3 MODIFIED），因为 hunk 撤销不应改 P4 镜像
    const { stdout } = await run('git', ['diff', 'mirror/p4', '--', 'Source/f.cpp'], repo, true);
    expect(stdout).toContain('line 3 MODIFIED');
  });
});
