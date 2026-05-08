import React, { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';

function logLineClass(line: string): string {
  if (/\[ERROR\]/i.test(line)) return 'text-[#f48771]';
  if (/\[WARN\]/i.test(line)) return 'text-[#cca700]';
  if (/\[OK\]/i.test(line)) return 'text-[#4ec9b0]';
  if (/\[INFO\]/i.test(line)) return 'text-[#9cdcfe]';
  return 'text-[#888]';
}

export const LogPanel: React.FC = () => {
  const collapsed = useAppStore((s) => s.logCollapsed);
  const toggle = useAppStore((s) => s.toggleLog);
  const logs = useAppStore((s) => s.logs);
  const clearLogs = useAppStore((s) => s.clearLogs);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed) endRef.current?.scrollIntoView({ block: 'end' });
  }, [logs.length, collapsed]);

  return (
    <>
      <div
        onClick={toggle}
        className="h-7 bg-[#252526] border-b border-[#333] flex items-center px-3 gap-2 cursor-pointer select-none hover:bg-[#2a2d2e]"
      >
        <span className="text-[10px] font-bold text-[#707070] tracking-wider uppercase">
          📋 操作日志
        </span>
        <span className="text-[10px] text-[#555]">· {logs.length} 条</span>
        <div className="ml-auto flex items-center gap-2">
          {!collapsed && (
            <button
              onClick={(e) => { e.stopPropagation(); clearLogs(); }}
              className="text-[#666] hover:text-[#ccc]"
              title="清空"
            >
              <Trash2 size={11} />
            </button>
          )}
          <span className="text-[#555]">
            {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div className="h-[120px] bg-[#1a1a1a] px-3 py-1.5 font-mono text-[10px] leading-[1.6] overflow-y-auto">
          {logs.map((l, i) => (
            <div key={i} className={logLineClass(l)}>{l}</div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </>
  );
};
