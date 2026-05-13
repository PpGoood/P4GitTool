import React, { useMemo, useState } from 'react';
import { useAppStore, useCurrentWorkspace } from '../store/appStore';
import { ConfirmDialog } from './ConfirmDialog';

export const StatusBar: React.FC = () => {
  const currentStream = useAppStore((s) => s.currentStream);
  const isLoading = useAppStore((s) => s.isLoading);
  const loadingOp = useAppStore((s) => s.loadingOp);
  const viewMode = useAppStore((s) => s.viewMode);
  const runReturnLatest = useAppStore((s) => s.runReturnLatest);
  const ws = useCurrentWorkspace();

  const [confirmReturn, setConfirmReturn] = useState<{ fileCount: number } | null>(null);

  const isDetached = viewMode.kind === 'detached';
  const viewingNode = viewMode.kind === 'viewing' ? viewMode.node : null;

  // 橙色状态栏：磁盘在 detached，且当前没浏览其他节点（或浏览的就是磁盘所在节点）
  const showDetachedBar = isDetached && (
    viewingNode === null || viewingNode.hash === ws.status?.headHash
  );

  const handleReturn = async () => {
    const result = await runReturnLatest(false);
    if (!result.ok && result.hasChanges) {
      setConfirmReturn({ fileCount: result.changes?.length ?? 0 });
    }
  };

  const lastSnapshot = useMemo(() => {
    if (!ws.snapshots.length) return null;
    return ws.snapshots[ws.snapshots.length - 1];
  }, [ws.snapshots]);

  const lastSnapshotLabel = lastSnapshot
    ? new Date(lastSnapshot.date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '无';

  // detached 且在当前节点视图下：状态栏变橙色，显示"返回工作区"按钮
  if (showDetachedBar) {
    return (
      <>
        <div className="h-6 bg-[#c17e1a] flex items-center px-3 gap-3 text-[11px] text-white flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#f48771] animate-pulse" />
            历史查看模式 · 请勿修改文件
          </div>
          <div className="ml-auto">
            <button
              onClick={handleReturn}
              disabled={isLoading}
              className="bg-white/20 hover:bg-white/40 disabled:opacity-50 px-3 py-0.5 rounded text-[11px] font-bold"
            >
              返回工作区 →
            </button>
          </div>
        </div>

        <ConfirmDialog
          open={!!confirmReturn}
          title="返回工作区"
          message={`检测到 ${confirmReturn?.fileCount ?? 0} 个未提交改动`}
          detail="在历史查看模式下做的改动将被丢弃。如需保留请先手动备份。"
          confirmText="丢弃并返回"
          confirmVariant="danger"
          onConfirm={async () => {
            setConfirmReturn(null);
            await runReturnLatest(true);
          }}
          onClose={() => setConfirmReturn(null)}
        />
      </>
    );
  }

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
