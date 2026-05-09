import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useAppStore, useCurrentWorkspace } from '../store/appStore';
import { SnapshotEntry } from '../api/client';
import { RollbackDialog } from './RollbackDialog';

const COLORS: Record<SnapshotEntry['kind'], { border: string; bg: string; glow?: string; label: string; tagBg: string; tagText: string }> = {
  sync:           { border: '#007acc', bg: '#007acc33',                                label: 'P4 Sync',   tagBg: '#007acc22', tagText: '#007acc' },
  'sync-protect': { border: '#569cd6', bg: '#569cd622', glow: 'rgba(86,156,214,0.3)',  label: '自动保护',  tagBg: '#569cd622', tagText: '#569cd6' },
  manual:         { border: '#cca700', bg: '#cca70022', glow: 'rgba(204,167,0,0.35)',  label: '手动',      tagBg: '#cca70022', tagText: '#cca700' },
  submit:         { border: '#4ec9b0', bg: '#4ec9b022',                                label: 'P4 提交',   tagBg: '#4ec9b022', tagText: '#4ec9b0' },
  other:          { border: '#484848', bg: '#282828',                                  label: '其他',      tagBg: '#33333355', tagText: '#888'    },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function shortMsg(msg: string): string {
  const stripped = msg
    .replace(/^update: /, '')
    .replace(/^sync 前自动保护.*/, 'sync 前保护')
    .replace(/^submit: /, '')
    .replace(/^revert: /, 'revert ');
  return stripped.length > 18 ? stripped.slice(0, 17) + '…' : stripped;
}

export const Timeline: React.FC = () => {
  const ws = useCurrentWorkspace();
  const collapsed = useAppStore((s) => s.timelineCollapsed);
  const toggle = useAppStore((s) => s.toggleTimeline);
  const isDetached = useAppStore((s) => s.isDetached);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rollbackTarget, setRollbackTarget] = useState<SnapshotEntry | null>(null);

  // 当前 HEAD hash，用于高亮当前节点
  const headHash = ws.status?.headHash ?? '';

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [ws.snapshots.length]);

  return (
    <>
      <div
        onClick={toggle}
        className="h-8 bg-[#252526] border-b border-[#333] flex items-center px-3 gap-2 cursor-pointer select-none hover:bg-[#2a2d2e]"
      >
        <span className="text-[10px] font-bold text-[#707070] tracking-wider uppercase">
          ⏱ 快照时间线
        </span>
        {!collapsed && (
          <span className="text-[10px] text-[#555]">
            {isDetached ? '· 历史查看模式' : '· 点击节点查看历史'}
          </span>
        )}
        <span className="ml-auto text-[#555]">
          {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
      </div>

      {!collapsed && (
        <div
          ref={scrollRef}
          className="h-[110px] bg-[#1e1e1e] overflow-x-auto overflow-y-hidden border-b border-[#333]"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#444 #1e1e1e' }}
        >
          <div className="flex items-start h-full px-6" style={{ minWidth: 'max-content' }}>
            {ws.snapshots.map((s, i) => {
              const c = COLORS[s.kind];
              const isFirst = i === 0;
              const isCurrent = s.hash === headHash; // 当前 HEAD 节点
              return (
                <button
                  key={s.hash}
                  onClick={() => !isCurrent && setRollbackTarget(s)}
                  disabled={isCurrent}
                  title={isCurrent ? '当前所在节点' : '点击查看此节点'}
                  className={`flex flex-col items-center flex-shrink-0 w-[88px] pt-[26px] relative ${isCurrent ? 'cursor-default' : 'group cursor-pointer'}`}
                >
                  <div className="flex items-center w-full">
                    <div className={`flex-1 h-[2px] ${isFirst ? 'bg-transparent' : 'bg-[#3a3a3a]'}`} />
                    <div
                      className={`rounded-full border-2 transition-transform ${isCurrent ? 'w-4 h-4' : 'w-3 h-3 group-hover:scale-[1.35]'}`}
                      style={{
                        borderColor: isCurrent ? '#fff' : c.border,
                        background: isCurrent ? c.bg : c.bg,
                        boxShadow: isCurrent
                          ? `0 0 0 2px #fff4, 0 0 8px ${c.glow ?? c.border}88`
                          : c.glow ? `0 0 6px ${c.glow}` : undefined,
                      }}
                    />
                    <div className="flex-1 h-[2px] bg-[#3a3a3a]" />
                  </div>
                  <div className="mt-2 text-center w-[84px]">
                    <div className="text-[9px] text-[#555] mb-0.5">{formatTime(s.date)}</div>
                    <div className={`text-[10px] truncate ${isCurrent ? 'text-[#fff]' : 'text-[#999]'}`}>{shortMsg(s.message)}</div>
                    <div
                      className="inline-block text-[8px] mt-1 rounded px-1.5 py-0.5"
                      style={{ background: c.tagBg, color: c.tagText }}
                    >
                      {c.label}
                    </div>
                  </div>
                </button>
              );
            })}

            {/* 当前工作区节点（紫色） */}
            <div className="flex flex-col items-center flex-shrink-0 w-[88px] pt-[26px]">
              <div className="flex items-center w-full">
                <div className="flex-1 h-[2px] bg-[#3a3a3a]" />
                <div
                  className="w-3.5 h-3.5 rounded-full border-2"
                  style={{
                    borderColor: '#c586c0',
                    background: '#c586c022',
                    boxShadow: '0 0 8px rgba(197,134,192,0.35)',
                  }}
                />
                <div className="flex-1 h-[2px] bg-transparent" />
              </div>
              <div className="mt-2 text-center w-[84px]">
                <div className="text-[9px] text-[#555] mb-0.5">现在</div>
                <div className="text-[10px] text-[#999] truncate">
                  {ws.changes.length > 0 ? `${ws.changes.length} 个未提交` : '无改动'}
                </div>
                <div
                  className="inline-block text-[8px] mt-1 rounded px-1.5 py-0.5 border border-[#c586c044]"
                  style={{ background: '#c586c022', color: '#c586c0' }}
                >
                  工作区
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <RollbackDialog snapshot={rollbackTarget} onClose={() => setRollbackTarget(null)} />
    </>
  );
};
