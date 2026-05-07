import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { api } from '../api/client';

export function LogPanel() {
  const logs = useAppStore((s) => s.logs);
  const appendLog = useAppStore((s) => s.appendLog);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = api.subscribeLog(appendLog);
    return unsub;
  }, [appendLog]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] font-mono text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#2d2d2d] border-b border-[#3e3e42]">
        <span className="text-[#858585] text-[11px] uppercase tracking-wider">输出</span>
        <button
          onClick={() => useAppStore.getState().clearLogs()}
          className="text-[#858585] hover:text-[#cccccc] text-[11px] transition-colors"
        >
          清空
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {logs.length === 0 && (
          <div className="text-[#555] italic">等待操作...</div>
        )}
        {logs.map((line, i) => (
          <LogLine key={i} line={line} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function LogLine({ line }: { line: string }) {
  let color = 'text-[#cccccc]';
  if (line.startsWith('[OK]'))    color = 'text-[#4ec9b0]';
  if (line.startsWith('[ERROR]')) color = 'text-[#f44747]';
  if (line.startsWith('[WARN]'))  color = 'text-[#dcdcaa]';
  if (line.startsWith('[INFO]'))  color = 'text-[#9cdcfe]';

  return <div className={`${color} leading-5 whitespace-pre-wrap break-all`}>{line}</div>;
}
