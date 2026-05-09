import React, { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useAppStore, useCurrentWorkspace } from '../store/appStore';
import { SnapshotEntry } from '../api/client';

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
    .replace(/^sync: /, '')
    .replace(/^sync-protect: /, '')
    .replace(/^submit: /, '')
    .replace(/^init: /, '');
  return stripped.length > 18 ? stripped.slice(0, 17) + '…' : stripped;
}

// 节点圆心距容器顶部的距离（px），用于对齐横线
const NODE_TOP = 32;

export const Timeline: React.FC = () => {
  const ws = useCurrentWorkspace();
  const collapsed = useAppStore((s) => s.timelineCollapsed);
  const toggle = useAppStore((s) => s.toggleTimeline);
  const viewNode = useAppStore((s) => s.viewNode);
  const viewingNode = useAppStore((s) => s.viewingNode);
  const exitNodeView = useAppStore((s) => s.exitNodeView);
  const scrollRef = useRef<HTMLDivElement>(null);

  const headHash = ws.status?.headHash ?? '';
  const isViewing = !!viewingNode;

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
            {isViewing ? '· 历史查看中' : '· 点击节点查看历史'}
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
          <div
            className="relative h-full"
            style={{ minWidth: `${Math.max(ws.snapshots.length, 1) * 88 + 48}px` }}
          >
            {/* 横线：从第一个节点圆心到最后一个节点圆心 */}
            {ws.snapshots.length > 1 && (
              <div
                className="absolute bg-[#3a3a3a]"
                style={{
                  height: '2px',
                  top: `${NODE_TOP}px`,
                  left: `${24 + 44}px`,
                  width: `${(ws.snapshots.length - 1) * 88}px`,
                }}
              />
            )}

            {/* 节点列表 */}
            <div className="absolute inset-0 flex items-start px-6">
              {ws.snapshots.map((s) => {
                const c = COLORS[s.kind];
                const isCurrent = s.hash === headHash;
                const isSelected = viewingNode?.hash === s.hash;

                return (
                  <button
                    key={s.hash}
                    onClick={() => viewNode(s)}
                    title={isCurrent ? '查看本次改动' : '点击查看此节点的改动'}
                    className="flex flex-col items-center flex-shrink-0 w-[88px] relative z-10 group cursor-pointer"
                    style={{ paddingTop: `${NODE_TOP - 6}px` }}
                  >
                    {/* 节点：选中或当前 = 正方形，其他 = 圆形 */}
                    <div
                      className={`border-2 transition-transform group-hover:scale-[1.2] ${
                        isCurrent || isSelected ? 'w-4 h-4 rounded-[3px]' : 'w-3 h-3 rounded-full'
                      }`}
                      style={{
                        borderColor: isCurrent
                          ? (ws.changes.length > 0 ? '#c586c0' : '#666')
                          : isSelected ? '#569cd6' : c.border,
                        background: isCurrent
                          ? (ws.changes.length > 0 ? '#c586c033' : '#1e1e1e')
                          : isSelected ? '#569cd622' : c.bg,
                        boxShadow: isCurrent && ws.changes.length > 0
                          ? '0 0 8px rgba(197,134,192,0.5)'
                          : isSelected
                          ? '0 0 8px rgba(86,156,214,0.5)'
                          : c.glow ? `0 0 6px ${c.glow}` : undefined,
                      }}
                    />

                    {/* 标签 */}
                    <div className="mt-2 text-center w-[84px]">
                      <div className="text-[9px] text-[#555] mb-0.5">{formatTime(s.date)}</div>
                      <div className={`text-[10px] truncate ${
                        isCurrent
                          ? (ws.changes.length > 0 ? 'text-[#c586c0]' : 'text-[#888]')
                          : isSelected ? 'text-[#569cd6]' : 'text-[#999]'
                      }`}>
                        {shortMsg(s.message)}
                      </div>
                      <div
                        className="inline-block text-[8px] mt-1 rounded px-1.5 py-0.5"
                        style={isCurrent
                          ? ws.changes.length > 0
                            ? { background: '#c586c022', color: '#c586c0', border: '1px solid #c586c044' }
                            : { background: '#33333355', color: '#666' }
                          : isSelected
                          ? { background: '#569cd622', color: '#569cd6', border: '1px solid #569cd644' }
                          : { background: c.tagBg, color: c.tagText }}
                      >
                        {isCurrent
                          ? (ws.changes.length > 0 ? `${ws.changes.length} 个改动` : '当前')
                          : isSelected ? '浏览中' : c.label}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
