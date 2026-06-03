import React, { useEffect, useState } from 'react';
import { useAppStore } from './store/appStore';
import { useEventStream } from './hooks/useEventStream';
import { TabBar } from './components/TabBar';
import { FileList } from './components/FileList';
import { DiffPanel } from './components/DiffPanel';
import { Timeline } from './components/Timeline';
import { LogPanel } from './components/LogPanel';
import { StatusBar } from './components/StatusBar';
import { ConfigDialog } from './components/ConfigDialog';
import { AlignConflictDialog } from './components/AlignConflictDialog';

const LOADING_MESSAGES: Record<string, string> = {
  init: '正在初始化工作区...',
  pull: '正在同步 P4...',
  'submit-prepare': '正在准备提交...',
  'submit-confirm': '正在确认提交...',
  'align-git': '正在对齐 Git...',
  'view-node': '正在加载节点改动...',
  checkout: '正在切换到历史节点...',
  'return-latest': '正在回到最新状态...',
  snapshot: '正在创建快照...',
  'check-update': '正在检查文件版本...',
  discard: '正在还原文件...',
};

const App: React.FC = () => {
  useEventStream();

  const loadConfig = useAppStore((s) => s.loadConfig);
  const config = useAppStore((s) => s.config);
  const isLoading = useAppStore((s) => s.isLoading);
  const loadingOp = useAppStore((s) => s.loadingOp);
  const logs = useAppStore((s) => s.logs);
  const [configOpen, setConfigOpen] = useState(false);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (config && config.streams.length === 0) setConfigOpen(true);
  }, [config]);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#1e1e1e] text-[#ccc] overflow-hidden">
      <TabBar onOpenConfig={() => setConfigOpen(true)} />

      {/* 全局操作遮罩 */}
      {isLoading && loadingOp && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex flex-col items-center justify-center gap-4">
          <div className="bg-[#252526] border border-[#444] rounded-lg px-8 py-6 flex flex-col items-center gap-4 min-w-[320px] max-w-[480px]">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-[#007acc] border-t-transparent rounded-full animate-spin" />
              <span className="text-[#ccc] text-[13px] font-bold">
                {LOADING_MESSAGES[loadingOp] ?? '处理中...'}
              </span>
            </div>
            {logs.length > 0 && (
              <div className="w-full bg-[#1a1a1a] rounded p-3 font-mono text-[10px] max-h-[120px] overflow-y-auto">
                {logs.slice(-6).map((l, i) => (
                  <div key={i} className={
                    /\[ERROR\]/i.test(l) ? 'text-[#f48771]' :
                    /\[OK\]/i.test(l) ? 'text-[#4ec9b0]' :
                    /\[WARN\]/i.test(l) ? 'text-[#cca700]' :
                    'text-[#888]'
                  }>{l}</div>
                ))}
              </div>
            )}
            <p className="text-[#666] text-[10px]">请勿关闭窗口或重复点击</p>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <FileList />
        <DiffPanel />
      </div>

      <Timeline />
      <LogPanel />
      <StatusBar />

      <ConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} />
      <AlignConflictDialog />
    </div>
  );
};

export default App;
