import chokidar, { FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

export interface WatcherOptions {
  debounceMs?: number;
}

/**
 * 监听多个 Git 仓库（对应多个 P4 stream）的文件变化。
 * 文件变化后防抖合并，发出 'changed' 事件（参数为 stream 名）。
 * 不做自动 commit，仅供前端刷新 UI。
 *
 * 同时精准监听每个仓库的 .git/logs/HEAD 单文件——
 * git commit 会更新 reflog，工作区文件不变也能感知 commit 发生，
 * 解决 "agent 提交后界面不刷新" 的盲区。其他 .git 文件仍忽略。
 *
 * 对未初始化的仓库（.git/logs/HEAD 暂不存在），用轻量轮询（5s）等待
 * init 完成，自动挂上 reflog watcher 后停止轮询。
 */
export class WorkspaceWatcher extends EventEmitter {
  private watchers = new Map<string, FSWatcher>();
  private reflogWatchers = new Map<string, FSWatcher>();
  private reflogPollingTimers = new Map<string, NodeJS.Timeout>();
  private timers = new Map<string, NodeJS.Timeout>();
  private debounceMs: number;

  constructor(opts: WatcherOptions = {}) {
    super();
    this.debounceMs = opts.debounceMs ?? 500;
  }

  async watch(streamName: string, repoPath: string): Promise<void> {
    await this.unwatch(streamName);

    const w = chokidar.watch(repoPath, {
      ignored: (p: string) => {
        const norm = p.replace(/\\/g, '/');
        // .git/logs/HEAD 由单独的 reflog 监听器处理，
        // 这里把 logs/HEAD 也排除避免重复触发，reflog watcher 会兜底
        if (/\/\.git\/logs\/HEAD$/.test(norm)) return true;
        return (
          /\/\.git(\/|$)/.test(norm) ||
          /\/Binaries(\/|$)/.test(norm) ||
          /\/Intermediate(\/|$)/.test(norm) ||
          /\/Saved(\/|$)/.test(norm) ||
          /\.lock$/.test(norm) ||
          /\.tmp$/.test(norm) ||
          /\/p4git\.yaml$/.test(norm) ||
          /\/\.p4git_pending\.yaml$/.test(norm)
        );
      },
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    w.on('all', () => this.schedule(streamName));

    // 等待 ready
    await new Promise<void>((resolve) => w.once('ready', () => resolve()));
    this.watchers.set(streamName, w);

    // 精准监听 .git/logs/HEAD 单文件：commit/checkout 会更新它，
    // 而 .git 其他文件继续被忽略。
    const reflogPath = path.join(repoPath, '.git', 'logs', 'HEAD');
    this.attachReflogWatcher(streamName, reflogPath);
  }

  /**
   * 挂上 reflog watcher。若文件尚未存在（仓库未 init），启动轻量轮询（5s）
   * 等 init 完成后再挂。挂上后停止轮询。
   */
  private attachReflogWatcher(streamName: string, reflogPath: string): void {
    if (this.reflogWatchers.has(streamName)) return;

    if (fs.existsSync(reflogPath)) {
      const rw = chokidar.watch(reflogPath, {
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      });
      rw.on('all', () => this.schedule(streamName));
      rw.once('ready', () => {
        // reflog watcher 已就绪
      });
      this.reflogWatchers.set(streamName, rw);
      return;
    }

    // reflog 暂不存在，启动 5s 轮询等 init 完成
    const poll = setInterval(async () => {
      if (!fs.existsSync(reflogPath)) return;
      clearInterval(poll);
      this.reflogPollingTimers.delete(streamName);
      // 再次防御：避免并发 race
      if (this.reflogWatchers.has(streamName)) return;
      const rw = chokidar.watch(reflogPath, {
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      });
      rw.on('all', () => this.schedule(streamName));
      this.reflogWatchers.set(streamName, rw);
    }, 5000);
    this.reflogPollingTimers.set(streamName, poll);
  }

  async unwatch(streamName: string): Promise<void> {
    const w = this.watchers.get(streamName);
    if (w) {
      await w.close();
      this.watchers.delete(streamName);
    }
    const rw = this.reflogWatchers.get(streamName);
    if (rw) {
      await rw.close();
      this.reflogWatchers.delete(streamName);
    }
    const pt = this.reflogPollingTimers.get(streamName);
    if (pt) {
      clearInterval(pt);
      this.reflogPollingTimers.delete(streamName);
    }
    const t = this.timers.get(streamName);
    if (t) {
      clearTimeout(t);
      this.timers.delete(streamName);
    }
  }

  async close(): Promise<void> {
    for (const [name] of this.watchers) await this.unwatch(name);
  }

  private schedule(streamName: string) {
    const prev = this.timers.get(streamName);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.timers.delete(streamName);
      this.emit('changed', streamName);
    }, this.debounceMs);
    this.timers.set(streamName, t);
  }
}
