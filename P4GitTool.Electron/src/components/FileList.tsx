import React, { useState } from 'react';
import { useAppStore, useCurrentWorkspace } from '../store/appStore';
import { SnapshotDialog } from './SnapshotDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { FileChange } from '../api/client';

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

function FileItem({ f, active, onClick, onContextMenu }: {
  f: FileChange;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const parts = f.path.split('/');
  const name = parts[parts.length - 1];
  const dir = parts.slice(0, -1).join('/');
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 border-b border-[#2a2a2a]
        ${active ? 'bg-[#2a2d2e] border-l-2 border-l-[#007acc]' : 'hover:bg-[#2a2a2a]'}`}
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
  const loadingOp = useAppStore((s) => s.loadingOp);
  const toggleLog = useAppStore((s) => s.toggleLog);
  const isDetached = useAppStore((s) => s.isDetached);

  // 历史节点查看模式
  const viewingNode = useAppStore((s) => s.viewingNode);
  const viewingFiles = useAppStore((s) => s.viewingFiles);
  const viewingSelectedFile = useAppStore((s) => s.viewingSelectedFile);
  const viewNodeSelectFile = useAppStore((s) => s.viewNodeSelectFile);
  const exitNodeView = useAppStore((s) => s.exitNodeView);
  const runCheckoutNode = useAppStore((s) => s.runCheckoutNode);

  const notInited = ws.status && !ws.status.gitInited;
  const isIniting = isLoading && loadingOp === 'init';
  const isViewing = !!viewingNode;

  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [checkoutConfirm, setCheckoutConfirm] = useState(false);
  const [discardFileConfirm, setDiscardFileConfirm] = useState<string | null>(null);

  const handleInit = async () => {
    toggleLog();
    await runInit();
  };

  // 当前显示的文件列表和选中文件
  const displayFiles = isViewing ? viewingFiles : ws.changes;
  const selectedFile = isViewing ? viewingSelectedFile : ws.selectedFile;

  return (
    <div className="w-[220px] bg-[#252526] border-r border-[#1a1a1a] flex flex-col flex-shrink-0">

      {/* Header：历史查看模式显示蓝色提示 */}
      {isViewing ? (
        <div className="px-3 py-2 border-b border-[#569cd644] bg-[#569cd611] flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-[#569cd6] tracking-wider uppercase flex-1">
              浏览历史节点
            </span>
          </div>
          {/* 返回按钮：非 detached 模式下显示，只是退出浏览。
              detached 模式下的"返回"走状态栏的橙色按钮 */}
          {!isDetached && (
            <button
              onClick={exitNodeView}
              className="w-full bg-[#2a2d2e] hover:bg-[#3c3c3c] text-[#ccc] text-[11px] py-1.5 rounded border border-[#444]"
            >
              ← 返回当前工作区
            </button>
          )}
          {/* Checkout 按钮：浏览的节点不是当前 HEAD 时显示（包括 detached 下切到其他节点） */}
          {viewingNode && viewingNode.hash !== ws.status?.headHash && (
            <button
              onClick={() => setCheckoutConfirm(true)}
              disabled={isLoading || ws.changes.length > 0}
              title={ws.changes.length > 0 ? '请先提交或丢弃当前改动' : '切换工作区到此节点验证问题'}
              className="w-full bg-[#569cd622] hover:bg-[#569cd633] disabled:opacity-40 disabled:cursor-not-allowed text-[#569cd6] text-[11px] py-1.5 rounded border border-[#569cd644]"
            >
              Checkout 到此节点
            </button>
          )}
        </div>
      ) : (
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
      )}

      {/* 历史节点信息 */}
      {isViewing && viewingNode && (
        <div className="px-3 py-1.5 border-b border-[#333] bg-[#1a1a1a]">
          <div className="text-[9px] text-[#666]">
            {new Date(viewingNode.date).toLocaleString('zh-CN')}
          </div>
          <div className="text-[10px] text-[#aaa] truncate">{viewingNode.message}</div>
          <div className="text-[9px] text-[#555]">{viewingFiles.length} 个文件改动</div>
        </div>
      )}

      {/* Files */}
      <div className="flex-1 overflow-y-auto">
        {!currentStream && (
          <div className="text-center text-[#666] text-[11px] py-8 px-3">
            请点击右上角 ⚙ 配置工作区
          </div>
        )}
        {currentStream && !isViewing && notInited && (
          <div className="text-center text-[#666] text-[11px] py-8 px-3">
            <div className="mb-3">工作区尚未初始化</div>
            <button
              onClick={handleInit}
              disabled={isIniting}
              className="bg-[#007acc] hover:bg-[#1c91ea] disabled:opacity-50 text-white text-[11px] font-bold px-4 py-2 rounded"
            >
              {isIniting ? '初始化中...' : '初始化工作区'}
            </button>
            {isIniting && (
              <div className="mt-2 text-[#569cd6] text-[10px]">请查看底部日志面板</div>
            )}
          </div>
        )}
        {displayFiles.length === 0 && !notInited && currentStream && (
          <div className="text-center text-[#666] text-[11px] py-8">
            {isViewing ? '此节点无文件改动' : '无改动文件'}
          </div>
        )}
        {displayFiles.map((f) => (
          <FileItem
            key={f.path}
            f={f}
            active={selectedFile === f.path}
            onClick={() => isViewing ? viewNodeSelectFile(f.path) : selectFile(currentStream, f.path)}
            onContextMenu={!isViewing ? (e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, filepath: f.path });
            } : undefined}
          />
        ))}
      </div>

      {/* Actions：历史查看模式下隐藏 */}
      {!isViewing && (
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
      )}

      {/* Context Menu（只在非历史模式下显示） */}
      {menu && !isViewing && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            className="fixed z-50 bg-[#2d2d2d] border border-[#444] rounded py-1 shadow-xl min-w-[160px]"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              onClick={() => {
                setDiscardFileConfirm(menu.filepath);
                setMenu(null);
              }}
              className="block w-full text-left px-3 py-1.5 text-[11px] text-[#ccc] hover:bg-[#3c3c3c]"
            >
              还原此文件到上个快照
            </button>
          </div>
        </>
      )}

      <SnapshotDialog open={snapshotOpen} onClose={() => setSnapshotOpen(false)} />

      {/* Checkout 确认弹窗 */}
      <ConfirmDialog
        open={checkoutConfirm}
        title="Checkout 到此节点"
        message={`切换工作区到节点 ${viewingNode?.hash.slice(0, 7) ?? ''}`}
        detail="工作区文件将变为该节点状态，验证完成后点击底部状态栏的「回到最新」。"
        confirmText="Checkout"
        confirmVariant="warning"
        disabled={ws.changes.length > 0}
        disabledReason={`当前有 ${ws.changes.length} 个未提交改动，请先提交快照或丢弃改动`}
        onConfirm={async () => {
          setCheckoutConfirm(false);
          if (viewingNode) await runCheckoutNode(viewingNode.hash);
        }}
        onClose={() => setCheckoutConfirm(false)}
      />

      {/* 还原文件确认弹窗 */}
      <ConfirmDialog
        open={!!discardFileConfirm}
        title="还原文件"
        message={`还原 ${discardFileConfirm} 到上个快照的状态？`}
        detail="此操作不可撤销，文件内容将恢复到上一个快照时的状态。"
        confirmText="还原"
        confirmVariant="danger"
        onConfirm={async () => {
          if (discardFileConfirm) await runDiscardFile(discardFileConfirm);
          setDiscardFileConfirm(null);
        }}
        onClose={() => setDiscardFileConfirm(null)}
      />
    </div>
  );
};
