import React, { useState } from 'react';
import { useAppStore, useCurrentWorkspace } from '../store/appStore';
import { SnapshotDialog } from './SnapshotDialog';

interface ContextMenu {
  x: number; y: number; filepath: string;
}

function statusClass(s: string) {
  if (s.startsWith('M')) return 'text-[#cca700]';
  if (s.startsWith('A') || s === '?') return 'text-[#4ec9b0]';
  if (s.startsWith('D')) return 'text-[#f48771]';
  if (s.startsWith('R')) return 'text-[#9cdcfe]';
  return 'text-[#888]';
}

function statusLetter(s: string): string {
  const c = s[0];
  return c && c !== '?' ? c : 'A';
}

export const FileList: React.FC = () => {
  const ws = useCurrentWorkspace();
  const currentStream = useAppStore((s) => s.currentStream);
  const selectFile = useAppStore((s) => s.selectFile);
  const runDiscardFile = useAppStore((s) => s.runDiscardFile);
  const runPull = useAppStore((s) => s.runPull);
  const runSubmitPrepare = useAppStore((s) => s.runSubmitPrepare);
  const runInit = useAppStore((s) => s.runInit);
  const isLoading = useAppStore((s) => s.isLoading);
  const notInited = ws.status && !ws.status.gitInited;

  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);

  return (
    <div className="w-[220px] bg-[#252526] border-r border-[#1a1a1a] flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[#333] flex items-center gap-2">
        <span className="text-[10px] font-bold text-[#707070] tracking-wider uppercase">
          改动文件
        </span>
        {ws.changes.length > 0 && (
          <span className="bg-[#007acc] text-white text-[9px] rounded-full px-1.5">
            {ws.changes.length}
          </span>
        )}
      </div>

      {/* Files */}
      <div className="flex-1 overflow-y-auto">
        {!currentStream && (
          <div className="text-center text-[#666] text-[11px] py-8 px-3">
            请点击右上角 ⚙ 配置工作区
          </div>
        )}
        {currentStream && notInited && (
          <div className="text-center text-[#666] text-[11px] py-8 px-3">
            <div className="mb-3">工作区尚未初始化</div>
            <button
              onClick={() => runInit()}
              disabled={isLoading}
              className="bg-[#007acc] hover:bg-[#1c91ea] disabled:opacity-50 text-white text-[11px] font-bold px-4 py-2 rounded"
            >
              初始化工作区
            </button>
          </div>
        )}
        {currentStream && !notInited && ws.changes.length === 0 && (
          <div className="text-center text-[#666] text-[11px] py-8">无改动文件</div>
        )}
        {ws.changes.map((f) => {
          const active = ws.selectedFile === f.path;
          const parts = f.path.split('/');
          const name = parts[parts.length - 1];
          const dir = parts.slice(0, -1).join('/');
          return (
            <button
              key={f.path}
              onClick={() => selectFile(currentStream, f.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, filepath: f.path });
              }}
              className={`
                w-full text-left px-3 py-1.5 flex items-center gap-2 border-b border-[#2a2a2a]
                ${active
                  ? 'bg-[#2a2d2e] border-l-2 border-l-[#007acc]'
                  : 'hover:bg-[#2a2a2a]'}
              `}
            >
              <span className={`text-[9px] font-bold w-3 ${statusClass(f.status)}`}>
                {statusLetter(f.status)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-[#ccc] truncate">{name}</div>
                {dir && <div className="text-[10px] text-[#666] truncate">{dir}/</div>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Actions */}
      <div className="p-2.5 border-t border-[#333] flex flex-col gap-1.5">
        <button
          onClick={() => setSnapshotOpen(true)}
          disabled={isLoading || ws.changes.length === 0}
          className="bg-[#007acc] hover:bg-[#1c91ea] disabled:opacity-50 text-white text-[11px] font-bold py-1.5 rounded"
        >
          ⊙ 提交快照
        </button>
        <button
          onClick={() => runSubmitPrepare()}
          disabled={isLoading}
          className="bg-[#333] hover:bg-[#3c3c3c] disabled:opacity-50 text-[#ccc] text-[11px] py-1.5 rounded border border-[#444]"
        >
          ↑ 提交到 P4
        </button>
        <button
          onClick={() => runPull()}
          disabled={isLoading}
          className="bg-[#333] hover:bg-[#3c3c3c] disabled:opacity-50 text-[#ccc] text-[11px] py-1.5 rounded border border-[#444]"
        >
          ↓ P4 Sync
        </button>
      </div>

      {/* Context Menu */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            className="fixed z-50 bg-[#2d2d2d] border border-[#444] rounded py-1 shadow-xl min-w-[160px]"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              onClick={async () => {
                await runDiscardFile(menu.filepath);
                setMenu(null);
              }}
              className="block w-full text-left px-3 py-1.5 text-[11px] text-[#ccc] hover:bg-[#3c3c3c]"
            >
              还原此文件到 P4 版本
            </button>
          </div>
        </>
      )}

      <SnapshotDialog
        open={snapshotOpen}
        onClose={() => setSnapshotOpen(false)}
      />
    </div>
  );
};
