import React, { useState } from 'react';
import { useAppStore, useCurrentWorkspace } from '../store/appStore';
import { SnapshotEntry } from '../api/client';

interface Props {
  snapshot: SnapshotEntry | null;
  onClose: () => void;
}

export const RollbackDialog: React.FC<Props> = ({ snapshot, onClose }) => {
  const ws = useCurrentWorkspace();
  const runRollback = useAppStore((s) => s.runRollback);
  const [submitting, setSubmitting] = useState(false);

  if (!snapshot) return null;

  const hasChanges = ws.changes.length > 0;

  const submit = async () => {
    setSubmitting(true);
    const ok = await runRollback(snapshot.hash);
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-[#252526] border border-[#444] rounded-lg w-[460px] p-5">
        <h3 className="text-[14px] font-bold text-white mb-3">回滚到此节点</h3>

        <div className="bg-[#1e1e1e] rounded p-3 mb-3 border border-[#333]">
          <div className="text-[10px] text-[#888] mb-1">
            {new Date(snapshot.date).toLocaleString('zh-CN')}
          </div>
          <div className="text-[12px] text-[#ccc] break-all">{snapshot.message}</div>
          <div className="text-[10px] text-[#569cd6] mt-1">
            {snapshot.fileCount} 个文件 · {snapshot.hash.slice(0, 7)}
          </div>
        </div>

        {hasChanges ? (
          <div className="bg-[#f4877122] border border-[#f4877144] rounded p-3 text-[11px] text-[#f48771]">
            当前有 {ws.changes.length} 个未提交的改动。请先提交快照或还原所有改动，再执行回滚。
          </div>
        ) : (
          <p className="text-[11px] text-[#888]">
            回滚会把工作区文件恢复到此状态，并产生一个新的回滚快照记录。原有历史不会丢失。
          </p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-[11px] text-[#ccc] hover:bg-[#333] rounded">
            取消
          </button>
          <button
            onClick={submit}
            disabled={hasChanges || submitting}
            className="px-3 py-1.5 bg-[#cca700] hover:bg-[#e0b800] disabled:opacity-40 disabled:cursor-not-allowed text-black text-[11px] font-bold rounded"
          >
            {submitting ? '回滚中...' : '确认回滚'}
          </button>
        </div>
      </div>
    </div>
  );
};
