import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./runner', () => ({
  run: vi.fn(),
}));

import * as runner from './runner';
import { applyReversePatch, gitCheckoutFile } from './git';

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
    // git.ts 的 applyReversePatch 在失败路径里 console.error 输出 patch + stderr，
    // 这里静音掉避免污染 CI 日志（被静音掉的 stderr 在产物里仍可读）
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = await applyReversePatch('/repo', 'BAD');
    expect(ok).toBe(false);
    errSpy.mockRestore();
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
