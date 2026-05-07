import { useState } from 'react';
import { FileText, GitCommit, Send } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export function ChangesPanel() {
  const changes = useAppStore((s) => s.changes);
  const runCreateSnapshot = useAppStore((s) => s.runCreateSnapshot);
  const appendLog = useAppStore((s) => s.appendLog);
  const [message, setMessage] = useState('');

  const handleCommit = async () => {
    if (!message.trim()) { appendLog('[ERROR] 请输入提交信息'); return; }
    const ok = await runCreateSnapshot(message.trim());
    if (ok) setMessage('');
    else appendLog('[ERROR] Commit 失败');
  };

  const statusColor = (s: string) => {
    if (s === 'M') return 'text-[#dcdcaa]';
    if (s === 'A' || s === '?') return 'text-[#4ec9b0]';
    if (s === 'D') return 'text-[#f44747]';
    return 'text-[#858585]';
  };

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#3e3e42] text-[#858585] text-[11px] uppercase tracking-wider">
        <FileText size={12} />
        <span>改动文件</span>
        {changes.length > 0 && (
          <span className="bg-[#007acc] text-white text-[10px] px-1.5 rounded-full ml-1">
            {changes.length}
          </span>
        )}
      </div>

      {/* 文件列表 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {changes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#555] text-xs gap-2">
            <GitCommit size={24} className="opacity-30" />
            <span>工作区干净</span>
          </div>
        ) : (
          changes.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#2a2d2e] border-b border-[#2d2d2d]"
            >
              <span className={`text-[11px] font-mono font-bold w-4 shrink-0 ${statusColor(f.status)}`}>
                {f.status}
              </span>
              <span className="text-[#cccccc] text-xs truncate font-mono">{f.path}</span>
            </div>
          ))
        )}
      </div>

      {/* Commit 区域 */}
      <div className="border-t border-[#3e3e42] p-3 space-y-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
          placeholder="输入提交信息..."
          className="w-full bg-[#3c3c3c] text-[#cccccc] text-xs px-2 py-1.5 rounded border border-[#555] outline-none focus:border-[#007acc] placeholder-[#555]"
        />
        <button
          onClick={handleCommit}
          disabled={!message.trim() || changes.length === 0}
          className="w-full flex items-center justify-center gap-1.5 bg-[#007acc] hover:bg-[#1a8ad4] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs py-1.5 rounded transition-colors"
        >
          <Send size={12} />
          <span>Commit</span>
        </button>
      </div>
    </div>
  );
}
