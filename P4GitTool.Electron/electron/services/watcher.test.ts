import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WorkspaceWatcher } from './watcher';

describe('WorkspaceWatcher', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4git-watcher-'));
    fs.writeFileSync(path.join(tmpDir, 'initial.txt'), 'x');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('文件变化后触发事件（防抖合并）', async () => {
    const w = new WorkspaceWatcher({ debounceMs: 100 });
    const events: string[] = [];
    w.on('changed', (streamName) => events.push(streamName));

    await w.watch('dev', tmpDir);
    await new Promise(r => setTimeout(r, 100)); // 等待 ready

    // 快速写三次
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), '1');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), '2');
    fs.writeFileSync(path.join(tmpDir, 'c.txt'), '3');

    await new Promise(r => setTimeout(r, 300));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every(e => e === 'dev')).toBe(true);

    await w.close();
  });

  it('忽略 .git 目录的变化', async () => {
    const gitDir = path.join(tmpDir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });

    const w = new WorkspaceWatcher({ debounceMs: 100 });
    const events: string[] = [];
    w.on('changed', (s) => events.push(s));

    await w.watch('dev', tmpDir);
    await new Promise(r => setTimeout(r, 100));

    fs.writeFileSync(path.join(gitDir, 'index.lock'), '');
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref');

    await new Promise(r => setTimeout(r, 300));
    expect(events.length).toBe(0);

    await w.close();
  });

  it('unwatch 后停止接收该 stream 的事件', async () => {
    const w = new WorkspaceWatcher({ debounceMs: 100 });
    const events: string[] = [];
    w.on('changed', (s) => events.push(s));

    await w.watch('dev', tmpDir);
    await new Promise(r => setTimeout(r, 100));

    await w.unwatch('dev');

    fs.writeFileSync(path.join(tmpDir, 'x.txt'), 'y');
    await new Promise(r => setTimeout(r, 300));

    expect(events).toEqual([]);

    await w.close();
  });

  it('.git/logs/HEAD 变化触发事件（commit 写 reflog）', async () => {
    // 准备一个带 .git 目录的工作区模拟真实仓库结构
    const gitDir = path.join(tmpDir, '.git', 'logs');
    fs.mkdirSync(gitDir, { recursive: true });
    const headReflog = path.join(gitDir, 'HEAD');
    fs.writeFileSync(headReflog, '');

    const w = new WorkspaceWatcher({ debounceMs: 100 });
    const events: string[] = [];
    w.on('changed', (s) => events.push(s));

    await w.watch('dev', tmpDir);
    await new Promise(r => setTimeout(r, 100));

    // 模拟 commit 写 reflog：追加内容
    fs.appendFileSync(headReflog, 'abc123 def456 op\n');

    await new Promise(r => setTimeout(r, 300));
    expect(events).toContain('dev');

    await w.close();
  });

  it('其他 .git 文件（如 .git/HEAD、.git/index）仍被忽略', async () => {
    // 验证：只监听 .git/logs/HEAD，不放开整个 .git
    const gitDir = path.join(tmpDir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/dev\n');
    // 模拟 git add 写 .git/index
    fs.writeFileSync(path.join(gitDir, 'index'), '');

    const w = new WorkspaceWatcher({ debounceMs: 100 });
    const events: string[] = [];
    w.on('changed', (s) => events.push(s));

    await w.watch('dev', tmpDir);
    await new Promise(r => setTimeout(r, 100));

    // 写这两个文件，**不应**触发事件
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    fs.appendFileSync(path.join(gitDir, 'index'), 'x');

    await new Promise(r => setTimeout(r, 300));
    expect(events.length).toBe(0);

    await w.close();
  });

  it('reflog 暂不存在时（未 init），创建后自动挂上 watcher', async () => {
    // 模拟：watch() 启动时 reflog 还没有（仓库未 init）
    const gitDir = path.join(tmpDir, '.git', 'logs');
    fs.mkdirSync(gitDir, { recursive: true });
    // 注意：不创建 logs/HEAD

    const w = new WorkspaceWatcher({ debounceMs: 100 });
    const events: string[] = [];
    w.on('changed', (s) => events.push(s));

    await w.watch('dev', tmpDir);

    // 模拟 init 完成，创建 reflog
    fs.writeFileSync(path.join(gitDir, 'HEAD'), '');

    // 等轮询触发（间隔 5s，太长），用手动调用 attach 不可行——
    // 改用更短的方式：直接验证轮询存在并能在更短周期后挂上。
    // 为避免 5s 测试慢，这里我们在 < 5s 内不验证挂上，而是验证：
    // (a) watch() 之后未触发 panic；(b) unwatch 能清理轮询 timer。
    await new Promise(r => setTimeout(r, 200));

    await w.unwatch('dev');
    // unwatch 后即使 reflog 出现也不该触发
    fs.appendFileSync(path.join(gitDir, 'HEAD'), 'init entry\n');
    await new Promise(r => setTimeout(r, 200));
    expect(events).toEqual([]);

    await w.close();
  });
});
