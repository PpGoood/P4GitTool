import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./runner', () => ({
  run: vi.fn(),
}));

import * as runner from './runner';
import { diffFile, applyReversePatch, gitCheckoutFile } from './git';

describe('diffFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('对比工作区与 mirror/p4 返回 unified diff', async () => {
    (runner.run as any).mockResolvedValue({ code: 0, stdout: 'diff --git a/x b/x\n', stderr: '' });

    const out = await diffFile('/repo', 'Source/Weapon.cpp', 'mirror/p4');
    expect(out).toContain('diff --git');

    const args = (runner.run as any).mock.calls[0][1];
    expect(args).toContain('diff');
    expect(args).toContain('mirror/p4');
    expect(args).toContain('--');
    expect(args).toContain('Source/Weapon.cpp');
  });
});

describe('applyReversePatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('通过 stdin 传入 patch 并使用 --reverse', async () => {
    (runner.run as any).mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const ok = await applyReversePatch('/repo', 'PATCH_CONTENT');
    expect(ok).toBe(true);

    const [cmd, args, , , stdin] = (runner.run as any).mock.calls[0];
    expect(cmd).toBe('git');
    expect(args).toContain('apply');
    expect(args).toContain('--reverse');
    expect(stdin).toBe('PATCH_CONTENT');
  });

  it('apply 失败返回 false', async () => {
    (runner.run as any).mockResolvedValue({ code: 1, stdout: '', stderr: 'conflict' });
    const ok = await applyReversePatch('/repo', 'BAD');
    expect(ok).toBe(false);
  });
});

describe('gitCheckoutFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('从指定 ref 还原单个文件', async () => {
    (runner.run as any).mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const ok = await gitCheckoutFile('/repo', 'mirror/p4', 'Source/a.cpp');
    expect(ok).toBe(true);

    const args = (runner.run as any).mock.calls[0][1];
    expect(args).toEqual(['checkout', 'mirror/p4', '--', 'Source/a.cpp']);
  });
});
