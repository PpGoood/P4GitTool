import { describe, it, expect, vi, beforeEach } from 'vitest';

// 先 mock 再 import
vi.mock('./runner', () => ({
  run: vi.fn(),
}));

import * as runner from './runner';
import { p4CreateChangelist, p4SyncKeep } from './p4';
import type { P4GitConfig } from './config';

const cfg: P4GitConfig = {
  p4_port: 'ssl:server:1666',
  p4_user: 'alice',
  workspaces_dir: '',
  streams: [{ name: 'dev', client: 'alice_dev', root: 'D:/P4/dev' }],
};

describe('p4CreateChangelist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('通过 stdin 传入 spec 并解析 Changelist 号', async () => {
    (runner.run as any).mockResolvedValue({
      code: 0,
      stdout: 'Change 88502 created with 3 open file(s).\n',
      stderr: '',
    });

    const cl = await p4CreateChangelist(cfg, 'dev', '测试提交', ['//depot/a.cpp', '//depot/b.h']);

    expect(cl).toBe(88502);

    const call = (runner.run as any).mock.calls[0];
    const [cmd, args, , silent, stdin] = call;
    expect(cmd).toBe('p4');
    expect(args).toContain('change');
    expect(args).toContain('-i');
    expect(stdin).toBeDefined();
    expect(stdin).toContain('Description:');
    expect(stdin).toContain('测试提交');
    expect(stdin).toContain('//depot/a.cpp');
    expect(stdin).toContain('//depot/b.h');
    expect(stdin).toContain('alice_dev');
    expect(stdin).toContain('alice');
  });

  it('未找到 stream 返回 -1', async () => {
    const cl = await p4CreateChangelist(cfg, 'nonexistent', 'desc', []);
    expect(cl).toBe(-1);
  });

  it('p4 返回未包含 Change 号时返回 -1', async () => {
    (runner.run as any).mockResolvedValue({
      code: 1, stdout: 'error', stderr: 'spec invalid',
    });
    const cl = await p4CreateChangelist(cfg, 'dev', 'desc', []);
    expect(cl).toBe(-1);
  });
});

describe('p4SyncKeep', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('使用 -k flag 对所有配置路径调用 p4 sync', async () => {
    (runner.run as any).mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const ok = await p4SyncKeep(cfg, 'dev');
    expect(ok).toBe(true);

    const call = (runner.run as any).mock.calls[0];
    const [cmd, args] = call;
    expect(cmd).toBe('p4');
    expect(args).toContain('sync');
    expect(args).toContain('-k');
  });

  it('stream 未配置返回 false', async () => {
    const ok = await p4SyncKeep(cfg, 'nope');
    expect(ok).toBe(false);
  });

  it('p4 失败返回 false', async () => {
    (runner.run as any).mockResolvedValue({ code: 1, stdout: '', stderr: 'fail' });
    const ok = await p4SyncKeep(cfg, 'dev');
    expect(ok).toBe(false);
  });
});
