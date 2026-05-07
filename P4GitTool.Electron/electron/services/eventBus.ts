export type AppEvent =
  | { type: 'log'; line: string }
  | { type: 'files-changed'; stream: string }
  | { type: 'op-done'; op: string; stream: string; ok: boolean; detail?: string };

export type EventListener = (e: AppEvent) => void;

export class EventBus {
  private listeners = new Set<EventListener>();

  subscribe(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  emit(e: AppEvent): void {
    for (const l of this.listeners) {
      try { l(e); } catch { /* 一个订阅者异常不应影响其他 */ }
    }
  }
}

// 全局单例
export const eventBus = new EventBus();

/**
 * 便捷方法：创建一个 log 回调，emit 到总线。
 * 传给 operations 的 LogFn 参数。
 */
export function makeLogFn(): (line: string) => void {
  return (line) => eventBus.emit({ type: 'log', line });
}
