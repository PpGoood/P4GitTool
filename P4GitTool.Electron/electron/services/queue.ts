/**
 * 串行化写操作队列。
 * 防止多个 git 写命令并发执行时的 index.lock 冲突。
 */
export class WriteQueue {
  private chain: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(() => fn(), () => fn());
    this.chain = next.catch(() => {});
    return next;
  }
}

// 全局单例：每个 Git 仓库共享一个队列
const queues = new Map<string, WriteQueue>();

export function getQueue(repoPath: string): WriteQueue {
  let q = queues.get(repoPath);
  if (!q) {
    q = new WriteQueue();
    queues.set(repoPath, q);
  }
  return q;
}
