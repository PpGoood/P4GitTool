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
});
