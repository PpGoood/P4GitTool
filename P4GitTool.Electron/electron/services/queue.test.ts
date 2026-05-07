import { describe, it, expect } from 'vitest';
import { WriteQueue } from './queue';

describe('WriteQueue', () => {
  it('串行执行多个任务', async () => {
    const q = new WriteQueue();
    const order: number[] = [];

    const t1 = q.enqueue(async () => {
      await new Promise(r => setTimeout(r, 30));
      order.push(1);
      return 'a';
    });
    const t2 = q.enqueue(async () => {
      order.push(2);
      return 'b';
    });
    const t3 = q.enqueue(async () => {
      order.push(3);
      return 'c';
    });

    const results = await Promise.all([t1, t2, t3]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(order).toEqual([1, 2, 3]);
  });

  it('任务抛出异常不影响后续任务', async () => {
    const q = new WriteQueue();
    const results: string[] = [];

    const t1 = q.enqueue(async () => { throw new Error('fail1'); });
    const t2 = q.enqueue(async () => { results.push('ok2'); return 'ok2'; });

    await expect(t1).rejects.toThrow('fail1');
    await expect(t2).resolves.toBe('ok2');
    expect(results).toEqual(['ok2']);
  });

  it('返回值类型保留', async () => {
    const q = new WriteQueue();
    const result: number = await q.enqueue(async () => 42);
    expect(result).toBe(42);
  });
});
