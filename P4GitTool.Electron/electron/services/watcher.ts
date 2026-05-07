import chokidar, { FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';

export interface WatcherOptions {
  debounceMs?: number;
}

/**
 * 监听多个 Git 仓库（对应多个 P4 stream）的文件变化。
 * 文件变化后防抖合并，发出 'changed' 事件（参数为 stream 名）。
 * 不做自动 commit，仅供前端刷新 UI。
 */
export class WorkspaceWatcher extends EventEmitter {
  private watchers = new Map<string, FSWatcher>();
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
        return (
          /\/\.git(\/|$)/.test(norm) ||
          /\/Binaries(\/|$)/.test(norm) ||
          /\/Intermediate(\/|$)/.test(norm) ||
          /\/Saved(\/|$)/.test(norm) ||
          /\.lock$/.test(norm)
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
  }

  async unwatch(streamName: string): Promise<void> {
    const w = this.watchers.get(streamName);
    if (w) {
      await w.close();
      this.watchers.delete(streamName);
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
