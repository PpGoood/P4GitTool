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
  const isLoading = useAppStore((s) => s.isLoading);
  const loadingOp = useAppStore((s) => s.loadingOp);
  const logs = useAppStore((s) => s.logs);
  const isDetached = useAppStore((s) => s.isDetached);
  const runReturnLatest = useAppStore((s) => s.runReturnLatest);
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

      {/* 全局操作遮罩：长时间操作期间阻止交互 */}
      {isLoading && loadingOp && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex flex-col items-center justify-center gap-4">
          <div className="bg-[#252526] border border-[#444] rounded-lg px-8 py-6 flex flex-col items-center gap-4 min-w-[320px] max-w-[480px]">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-[#007acc] border-t-transparent rounded-full animate-spin" />
              <span className="text-[#ccc] text-[13px] font-bold">
                {loadingOp === 'init' ? '正在初始化工作区...' :
                 loadingOp === 'pull' ? '正在同步 P4...' :
                 loadingOp === 'submit-prepare' ? '正在准备提交...' :
                 loadingOp === 'rollback' ? '正在回滚...' :
                 '处理中...'}
              </span>
            </div>
            {/* 显示最新几条日志 */}
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

      {/* 历史查看模式警告横幅 */}
      {isDetached && (
        <div className="bg-[#569cd6] text-white px-4 py-2 flex items-center gap-3 text-[12px]">
          <span>⚠ 当前处于历史查看模式，文件为只读状态，请勿修改文件</span>
          <button
            onClick={() => runReturnLatest()}
            className="ml-auto bg-white/20 hover:bg-white/40 px-3 py-1 rounded font-bold"
          >
            回到最新工作状态
          </button>
        </div>
      )}

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
