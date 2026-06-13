import React from 'react';
import { RefreshCcw, Settings, Bot } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { api } from '../api/client';

interface Props {
  onOpenConfig: () => void;
}

export const TabBar: React.FC<Props> = ({ onOpenConfig }) => {
  const config = useAppStore((s) => s.config);
  const currentStream = useAppStore((s) => s.currentStream);
  const workspaces = useAppStore((s) => s.workspaces);
  const setCurrentStream = useAppStore((s) => s.setCurrentStream);
  const refreshWorkspace = useAppStore((s) => s.refreshWorkspace);

  const streams = config?.streams ?? [];

  return (
    <div
      className="h-[38px] bg-[#2d2d2d] flex items-center px-3 gap-2 border-b border-[#141414] select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="text-[#007acc] text-[13px] font-bold" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>⬡ P4Git</span>
      <div className="w-px h-4 bg-[#444] mx-1" />

      <div className="flex items-stretch h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {streams.map((s) => {
          const active = s.name === currentStream;
          const count = workspaces[s.name]?.changes.length ?? 0;
          return (
            <button
              key={s.name}
              onClick={() => setCurrentStream(s.name)}
              className={`
                relative px-4 text-[11px] cursor-pointer transition-colors
                ${active
                  ? 'bg-[#1e1e1e] text-white border-t-2 border-[#007acc]'
                  : 'text-[#888] hover:text-[#ccc] hover:bg-[#333]'}
              `}
            >
              {s.name}
              {count > 0 && (
                <span className="absolute top-1 right-1 bg-[#cca700] text-black text-[8px] font-bold rounded-full px-1">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex gap-1 mr-[138px]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={() => currentStream && api.openClaude(currentStream)}
          title="在当前工作区打开 Claude（恢复历史对话）"
          className="w-7 h-7 flex items-center justify-center text-[#888] hover:text-[#ccc] hover:bg-[#3c3c3c] rounded"
        >
          <Bot size={15} />
        </button>
        <button
          onClick={() => currentStream && refreshWorkspace(currentStream)}
          title="刷新"
          className="w-7 h-7 flex items-center justify-center text-[#888] hover:text-[#ccc] hover:bg-[#3c3c3c] rounded"
        >
          <RefreshCcw size={14} />
        </button>
        <button
          onClick={onOpenConfig}
          title="设置"
          className="w-7 h-7 flex items-center justify-center text-[#888] hover:text-[#ccc] hover:bg-[#3c3c3c] rounded"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
};
