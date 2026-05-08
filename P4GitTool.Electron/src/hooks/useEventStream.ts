import { useEffect } from 'react';
import { api, AppEvent } from '../api/client';
import { useAppStore } from '../store/appStore';

/**
 * 订阅后端 /api/events 统一事件流，自动触发数据刷新。
 * - log 事件 → 追加到日志
 * - files-changed 事件 → 刷新对应 stream 的 changes
 * - op-done 事件 → 刷新该 stream 全部数据
 */
export function useEventStream(): void {
  useEffect(() => {
    const unsub = api.subscribeEvents((e: AppEvent) => {
      const store = useAppStore.getState();

      switch (e.type) {
        case 'log':
          store.appendLog(e.line);
          break;

        case 'files-changed':
          store.refreshChanges(e.stream);
          break;

        case 'op-done':
          // 操作完成后刷新全部数据（含状态、快照）
          if (e.stream) store.refreshWorkspace(e.stream);
          break;
      }
    });

    return () => unsub();
  }, []);
}
