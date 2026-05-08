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
