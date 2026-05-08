import React, { useMemo } from 'react';
import { useAppStore, useCurrentWorkspace } from '../store/appStore';

export const StatusBar: React.FC = () => {
  const currentStream = useAppStore((s) => s.currentStream);
  const isLoading = useAppStore((s) => s.isLoading);
  const loadingOp = useAppStore((s) => s.loadingOp);
  const ws = useCurrentWorkspace();

  const lastSnapshot = useMemo(() => {
    if (!ws.snapshots.length) return null;
    return ws.snapshots[ws.snapshots.length - 1];
  }, [ws.snapshots]);

  const lastSnapshotLabel = lastSnapshot
    ? new Date(lastSnapshot.date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '无';

  return (
    <div className="h-6 bg-[#007acc] flex items-center px-3 gap-4 text-[11px] text-white/90 flex-shrink-0">
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-[#4ec9b0]" />
        {currentStream || '未选择工作区'}
      </div>

      <div className="flex items-center gap-1.5">
        最近快照 · {lastSnapshotLabel}
      </div>

      {isLoading && (
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#cca700] animate-pulse" />
          {loadingOp ?? '处理中'}...
        </div>
      )}

      <div className="ml-auto flex items-center gap-4">
        <span>{ws.changes.length} 个改动</span>
        <span className="opacity-60">P4Git Tool</span>
      </div>
    </div>
  );
};
