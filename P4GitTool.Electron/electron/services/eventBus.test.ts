import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus, AppEvent } from './eventBus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('订阅者收到 emit 的事件', () => {
    const received: AppEvent[] = [];
    const unsub = bus.subscribe((e) => received.push(e));

    bus.emit({ type: 'log', line: 'hello' });
    bus.emit({ type: 'files-changed', stream: 'dev' });

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({ type: 'log', line: 'hello' });
    expect(received[1]).toEqual({ type: 'files-changed', stream: 'dev' });

    unsub();
  });

  it('取消订阅后不再接收', () => {
    const received: AppEvent[] = [];
    const unsub = bus.subscribe((e) => received.push(e));
    unsub();

    bus.emit({ type: 'log', line: 'x' });
    expect(received).toHaveLength(0);
  });

  it('多个订阅者独立收到事件', () => {
    const a: AppEvent[] = [];
    const b: AppEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    bus.emit({ type: 'op-done', op: 'pull', stream: 'dev', ok: true });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});
