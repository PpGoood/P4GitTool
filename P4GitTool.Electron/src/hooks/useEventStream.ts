import { useEffect } from 'react';
import { api, AppEvent } from '../api/client';
import { useAppStore } from '../store/appStore';

/**
 * 订阅后端 /api/events 统一事件流，自动触发数据刷新。
 * - log 事件 → 追加到日志
 * - files-changed 事件 → 刷新该 stream 全部数据（包含 changes 和 snapshots）
 *   之所以全刷：commit 也会触发此事件（通过 .git/logs/HEAD 监听），
 *   此时需要同步刷新快照时间线显示新节点，单刷 changes 不够。
 *   开销小（本地 3 个 git 命令 ~200ms），可接受。
 * - op-done 事件 → 刷新该 stream 全部数据
 */
export function useEventStream(): void {
  useEffect(() => {
    const unsub = api.subscribeEvents(
      (e: AppEvent) => {
        const store = useAppStore.getState();

        switch (e.type) {
          case 'log':
            store.appendLog(e.line);
            break;

          case 'files-changed':
            if (e.stream) store.refreshWorkspace(e.stream);
            break;

          case 'op-done':
            if (e.stream) store.refreshWorkspace(e.stream);
            break;
        }
      },
      (reason) => {
        // SSE 断开 / 重连提示 → 日志面板
        useAppStore.getState().appendLog(`[WARN] ${reason}`);
      },
    );

    return () => unsub();
  }, []);
}
