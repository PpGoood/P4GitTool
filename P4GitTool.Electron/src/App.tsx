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

const App: React.FC = () => {
  useEventStream();

  const loadConfig = useAppStore((s) => s.loadConfig);
  const config = useAppStore((s) => s.config);
  const submitPending = useAppStore((s) => s.submitPending);
  const submitChangelist = useAppStore((s) => s.submitChangelist);
  const runSubmitConfirm = useAppStore((s) => s.runSubmitConfirm);
  const setSubmitPending = useAppStore((s) => s.setSubmitPending);
  const [configOpen, setConfigOpen] = useState(false);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // 首次启动若未配置，自动弹出配置对话框
  useEffect(() => {
    if (config && config.streams.length === 0) setConfigOpen(true);
  }, [config]);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#1e1e1e] text-[#ccc] overflow-hidden">
      <TabBar onOpenConfig={() => setConfigOpen(true)} />

      {submitPending && (
        <div className="bg-[#cca700] text-black px-4 py-2 flex items-center gap-3 text-[12px]">
          <span>
            P4V 已打开
            {submitChangelist ? ` (CL ${submitChangelist})` : ''}
            ，完成提交后请点击：
          </span>
          <button
            onClick={() => runSubmitConfirm()}
            className="bg-black/20 hover:bg-black/40 px-3 py-1 rounded font-bold"
          >
            确认提交完成
          </button>
          <button
            onClick={() => setSubmitPending(false)}
            className="ml-auto text-[11px] opacity-60 hover:opacity-100"
          >
            取消
          </button>
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
    </div>
  );
};

export default App;
