import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const SnapshotDialog: React.FC<Props> = ({ open, onClose }) => {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const runSnapshot = useAppStore((s) => s.runSnapshot);

  if (!open) return null;

  const submit = async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    const ok = await runSnapshot(message.trim());
    setSubmitting(false);
    if (ok) {
      setMessage('');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-[#252526] border border-[#444] rounded-lg w-[440px] p-5">
        <h3 className="text-[14px] font-bold text-white mb-3">提交快照</h3>
        <p className="text-[11px] text-[#888] mb-3">给这次改动一个描述，作为时间线上的里程碑</p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="例如：武器伤害调整完成"
          rows={3}
          className="w-full bg-[#1e1e1e] border border-[#444] rounded p-2 text-[12px] text-[#ccc] resize-none focus:outline-none focus:border-[#007acc]"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] text-[#ccc] hover:bg-[#333] rounded"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={!message.trim() || submitting}
            className="px-3 py-1.5 bg-[#007acc] hover:bg-[#1c91ea] disabled:opacity-50 text-white text-[11px] font-bold rounded"
          >
            {submitting ? '提交中...' : '提交快照'}
          </button>
        </div>
      </div>
    </div>
  );
};
