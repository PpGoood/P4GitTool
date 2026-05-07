import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { run } from './runner';
import { parseUnifiedDiff, buildHunkReversePatch } from './diff';

/**
 * 不依赖 P4，只测纯 git 流程。
 * 构造一个临时仓库，模拟 "mirror/p4 + 用户分支" 的结构，
 * 验证 diff 解析 + git apply --reverse 能正确撤销 hunk。
 */
describe('git hunk discard flow (integration)', () => {
  let repo: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'p4git-int-'));
    await run('git', ['init', '-b', 'mirror/p4'], repo, true);
    await run('git', ['config', 'user.email', 'test@test'], repo, true);
    await run('git', ['config', 'user.name', 'Test'], repo, true);
    await run('git', ['config', 'core.autocrlf', 'false'], repo, true);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nline2\nline3\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'init'], repo, true);
    await run('git', ['checkout', '-b', 'dev'], repo, true);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('apply --reverse 可撤销一个 hunk', async () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nline2\nlineX\nline3\n');

    const { stdout: diff } = await run('git', ['diff', 'mirror/p4'], repo, true);
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);

    const patch = buildHunkReversePatch(files[0], files[0].hunks[0]);
    const { code } = await run('git', ['apply', '--reverse', '--whitespace=nowarn', '-'], repo, true, patch);
    expect(code).toBe(0);

    const content = fs.readFileSync(path.join(repo, 'a.txt'), 'utf-8');
    expect(content).toBe('line1\nline2\nline3\n');
  });
});
