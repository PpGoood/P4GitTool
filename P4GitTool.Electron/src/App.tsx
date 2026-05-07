/**
 * P4Git Tool - Main App
 * 迁移自 p4git-modern-tool，接入真实 API
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Settings, Terminal, Search, RefreshCcw, Play,
  Download, Upload, Trash2, Clock, ChevronDown,
  GitBranch, FileText, AlertCircle, CheckCircle2,
  X, History, Code, Archive, Plus, RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppStore } from './store/appStore';
import { api } from './api/client';
import { ConfigDialog } from './components/ConfigDialog';

// -------------------------------------------------------
// Types
// -------------------------------------------------------

interface FileChange {
  path: string;
  status: string;
}

interface Snapshot {
  hash: string;
  message: string;
  date: string;
}

interface StashEntry {
  index: number;
  name: string;
  branch: string;
  stream: string;
  date: string;
}

// -------------------------------------------------------
// Reusable Components
// -------------------------------------------------------

const SidebarButton = ({
  icon: Icon, label, hint, primary = false,
  onClick, disabled = false, loading = false,
}: {
  icon: any; label: string; hint?: string; primary?: boolean;
  onClick?: () => void; disabled?: boolean; loading?: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={disabled || loading}
    className={`
      w-full text-left px-4 py-3 flex items-start gap-4 transition-all relative group
      ${disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      ${primary
        ? 'bg-[#007acc] hover:bg-[#1c91ea] text-white'
        : 'hover:bg-[#2a2d2e] text-[#d4d4d4]'}
    `}
  >
    {!primary && (
      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#007acc] opacity-0 group-hover:opacity-100 transition-opacity" />
    )}
    <div className="shrink-0 mt-0.5">
      {loading
        ? <RefreshCcw className="animate-spin text-white" size={16} />
        : <Icon className={primary ? 'text-white' : 'text-[#969696] group-hover:text-[#d4d4d4] transition-colors'} size={16} />
      }
    </div>
    <div className="flex flex-col">
      <span className="text-[13px] font-semibold leading-tight tracking-wide">{label}</span>
      {hint && <span className={`text-[11px] mt-0.5 ${primary ? 'text-blue-100' : 'text-[#969696]'}`}>{hint}</span>}
    </div>
    {primary && (
      <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
    )}
  </button>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div className="px-4 py-3 text-[11px] font-bold text-[#707070] tracking-[0.1em] uppercase">
    {children}
  </div>
);

const Badge = ({ label, statusText, ok }: { label: string; statusText: string; ok: boolean }) => (
  <div className="px-5 py-1.5 flex items-center gap-3 text-[12px] group">
    <div className={`w-2 h-2 rounded-full shrink-0 shadow-sm transition-all ${ok ? 'bg-[#4ec9b0] shadow-[0_0_6px_rgba(78,201,176,0.4)]' : 'bg-[#555] animate-pulse-custom'}`} />
    <span className="text-[#969696]">{label}</span>
    <span className={`ml-auto text-[11px] font-semibold ${ok ? 'text-[#4ec9b0]' : 'text-[#646464]'}`}>{statusText}</span>
  </div>
);

// -------------------------------------------------------
// Main App
// -------------------------------------------------------

export default function App() {
  const config        = useAppStore(s => s.config);
  const stream        = useAppStore(s => s.stream);
  const status        = useAppStore(s => s.status);
  const changes       = useAppStore(s => s.changes);
  const snapshots     = useAppStore(s => s.snapshots);
  const stashes       = useAppStore(s => s.stashes);
  const isLoading     = useAppStore(s => s.isLoading);
  const logs          = useAppStore(s => s.logs);
  const setStream     = useAppStore(s => s.setStream);
  const appendLog     = useAppStore(s => s.appendLog);
  const clearLogs     = useAppStore(s => s.clearLogs);
  const loadConfig    = useAppStore(s => s.loadConfig);
  const refreshAll    = useAppStore(s => s.refreshAll);
  const runInit       = useAppStore(s => s.runInit);
  const runPull       = useAppStore(s => s.runPull);
  const runCheckAndUpdate  = useAppStore(s => s.runCheckAndUpdate);
  const runSubmitPrepare   = useAppStore(s => s.runSubmitPrepare);
  const runSubmitConfirm   = useAppStore(s => s.runSubmitConfirm);
  const runCreateSnapshot  = useAppStore(s => s.runCreateSnapshot);
  const runCreateStash     = useAppStore(s => s.runCreateStash);
  const runPopStash        = useAppStore(s => s.runPopStash);
  const runDropStash       = useAppStore(s => s.runDropStash);

  const [showConfig,    setShowConfig]    = useState(false);
  const [showStashes,   setShowStashes]   = useState(false);
  const [snapshotMsg,   setSnapshotMsg]   = useState('');
  const [newStashName,  setNewStashName]  = useState('');
  const [showStashInput,setShowStashInput]= useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [showSearch,    setShowSearch]    = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 初始化
  useEffect(() => { loadConfig(); }, []);

  // SSE 日志订阅
  useEffect(() => {
    const unsub = api.subscribeLog(appendLog);
    return unsub;
  }, [appendLog]);

  // 自动滚动日志
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // 定时刷新
  useEffect(() => {
    if (!stream) return;
    const t = setInterval(() => refreshAll(), 10000);
    return () => clearInterval(t);
  }, [stream]);

  const streams = config?.streams.map(s => s.name) ?? [];

  // 过滤改动文件
  const filteredChanges = searchQuery
    ? changes.filter(f => f.path.toLowerCase().includes(searchQuery.toLowerCase()))
    : changes;

  const handleSnapshot = async () => {
    if (!snapshotMsg.trim()) { appendLog('[ERROR] 请输入快照信息'); return; }
    const ok = await runCreateSnapshot(snapshotMsg.trim());
    if (ok) setSnapshotMsg('');
  };

  const handleNewStash = async () => {
    if (!newStashName.trim()) return;
    const ok = await runCreateStash(newStashName.trim());
    if (ok) { setNewStashName(''); setShowStashInput(false); }
  };

  const handlePopStash = async (entry: StashEntry) => {
    const curBranch = status?.branch ?? '';
    if (entry.branch !== curBranch) {
      const ok = window.confirm(
        `该 Stash 来自分支：${entry.branch}\n当前分支：${curBranch}\n\n确定要恢复到当前分支吗？`
      );
      if (!ok) return;
    }
    await runPopStash(entry.index);
  };

  const handleDropStash = async (entry: StashEntry) => {
    if (!window.confirm(`确定要删除 Stash「${entry.name}」吗？`)) return;
    await runDropStash(entry.index);
  };

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] text-[#d4d4d4] overflow-hidden select-none">

      {/* ── Title Bar ── */}
      <header
        className="h-10 bg-[#2d2d2d] flex items-center justify-between px-4 shrink-0 border-b border-[#141414]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Code size={15} className="text-[#007acc]" />
          <span className="text-[13px] font-bold text-[#d4d4d4] tracking-wide">P4Git Tool</span>

          {/* Stream selector */}
          <div className="relative ml-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <select
              value={stream}
              onChange={e => setStream(e.target.value)}
              className="appearance-none bg-[#3c3c3c] text-[#d4d4d4] text-[12px] pl-2 pr-6 py-1 rounded border border-[#555] outline-none cursor-pointer hover:border-[#007acc] transition-colors"
            >
              {streams.length === 0 && <option value="">未配置</option>}
              {streams.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#858585] pointer-events-none" />
          </div>
        </div>

        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="p-2 hover:bg-[#3c3c3c] rounded transition-colors text-[#969696] hover:text-[#d4d4d4]"
          >
            <Search size={14} />
          </button>
          <button
            onClick={() => refreshAll()}
            className="p-2 hover:bg-[#3c3c3c] rounded transition-colors text-[#969696] hover:text-[#d4d4d4]"
          >
            <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowConfig(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[#3c3c3c] rounded transition-colors text-[#969696] hover:text-[#d4d4d4] text-[12px]"
          >
            <Settings size={13} />
            <span>Configure</span>
          </button>
        </div>
      </header>

      {/* ── Search Bar ── */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 36, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-[#252526] border-b border-[#333] flex items-center px-4 gap-2 overflow-hidden shrink-0"
          >
            <Search size={13} className="text-[#969696]" />
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter changed files..."
              className="flex-1 bg-transparent text-[12px] text-[#d4d4d4] outline-none placeholder-[#555]"
            />
            <button onClick={() => { setShowSearch(false); setSearchQuery(''); }}>
              <X size={13} className="text-[#969696] hover:text-[#d4d4d4]" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Body ── */}
      <main className="flex flex-1 min-h-0">

        {/* ── Left Sidebar ── */}
        <aside className="w-[260px] bg-[#252526] flex flex-col border-r border-[#1a1a1a] shrink-0 overflow-y-auto">

          {/* Status */}
          <SectionTitle>Status</SectionTitle>
          <Badge label="Git Repo"  statusText={status?.gitInited ? 'Initialized' : 'Not Init'} ok={!!status?.gitInited} />
          <Badge label="Junction"  statusText={status?.junctionOk ? 'Linked'      : 'Missing'}  ok={!!status?.junctionOk} />

          {/* Branch */}
          {status?.gitInited && (
            <div className="px-5 py-2">
              <div className="flex items-center gap-2 bg-[#1e1e1e] px-3 py-2 rounded-lg border border-[#333]">
                <GitBranch size={12} className="text-[#007acc] shrink-0" />
                <span className="text-[12px] text-[#d4d4d4] truncate flex-1">{status.branch || '—'}</span>
                {status.pendingSubmit && (
                  <span className="text-[10px] bg-[#cca700]/20 text-[#cca700] px-1.5 py-0.5 rounded font-bold">PENDING</span>
                )}
              </div>
            </div>
          )}

          <div className="h-px bg-[#333] mx-4 my-1" />

          {/* Actions */}
          <SectionTitle>Actions</SectionTitle>

          {!status?.gitInited ? (
            <SidebarButton icon={Settings} label="Init Workspace" hint="Initialize Git + Junctions" primary onClick={runInit} loading={isLoading} />
          ) : (
            <>
              <SidebarButton icon={Download} label="Pull from P4" hint="Sync latest P4 changes" onClick={() => runPull()} disabled={isLoading} loading={isLoading} />
              <div className="h-px bg-[#333] mx-4 my-1" />
              <SidebarButton icon={Play}   label="Check & Update" hint="Verify and sync outdated files" onClick={runCheckAndUpdate} disabled={isLoading} loading={isLoading} />
              <SidebarButton icon={Upload} label="Submit to P4V"  hint="Reconcile and open P4V"        onClick={runSubmitPrepare}  disabled={isLoading} loading={isLoading} />
              {status?.pendingSubmit && (
                <SidebarButton icon={CheckCircle2} label="Confirm Submit" hint="P4V submit completed" primary onClick={runSubmitConfirm} loading={isLoading} />
              )}
            </>
          )}

          <div className="flex-1" />

          {/* Loading indicator */}
          {isLoading && (
            <div className="px-4 py-3 flex items-center gap-2 text-[#969696] text-[11px] border-t border-[#333]">
              <RefreshCcw size={11} className="animate-spin" />
              <span>Processing...</span>
            </div>
          )}
        </aside>

        {/* ── Center Panel ── */}
        <section className="w-[300px] bg-[#252526] flex flex-col border-r border-[#1a1a1a] shrink-0">

          {/* Changed Files */}
          <SectionTitle>
            Changed Files
            {changes.length > 0 && (
              <span className="ml-2 bg-[#007acc] text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                {changes.length}
              </span>
            )}
          </SectionTitle>

          <div className="flex-1 overflow-y-auto min-h-0 max-h-[220px]">
            {filteredChanges.length === 0 ? (
              <div className="px-5 py-4 text-[11px] text-[#555] italic">
                {searchQuery ? 'No matches' : 'Working tree clean'}
              </div>
            ) : (
              filteredChanges.map((file, i) => {
                const parts    = file.path.replace(/\\/g, '/').split('/');
                const fileName = parts.pop() ?? file.path;
                const dirPath  = parts.join('/');
                return (
                  <div key={i} className="flex items-center gap-3 px-5 py-2 hover:bg-[#2a2d2e] transition-colors border-b border-[#2a2a2a]">
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded shrink-0 ${
                      file.status === 'M' ? 'bg-yellow-500/10 text-yellow-400' :
                      file.status === 'A' || file.status === '?' ? 'bg-green-500/10 text-green-400' :
                      'bg-red-500/10 text-red-400'
                    }`}>{file.status === '?' ? 'A' : file.status}</span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[12px] font-bold text-[#e0e0e0] leading-snug truncate">{fileName}</span>
                      {dirPath && <span className="text-[10px] text-[#707070] truncate">{dirPath}</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="h-px bg-[#333] mx-4 my-1" />

          {/* Branch Snapshot */}
          <SectionTitle>Branch Snapshot</SectionTitle>
          <div className="px-4 pb-3 space-y-2">
            <input
              type="text"
              value={snapshotMsg}
              onChange={e => setSnapshotMsg(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSnapshot()}
              placeholder="Snapshot message..."
              className="w-full bg-[#1e1e1e] border border-[#333] px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#007acc]/40 focus:border-[#007acc]/60 rounded-md transition-all"
            />
            <button
              onClick={handleSnapshot}
              disabled={!snapshotMsg.trim() || changes.length === 0}
              className="w-full py-2 bg-[#333] hover:bg-[#404040] disabled:opacity-40 disabled:cursor-not-allowed text-[12px] font-semibold border border-[#404040] rounded-md flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <Clock size={13} className="text-[#808080]" />
              Save Snapshot
            </button>
          </div>

          <div className="h-px bg-[#333] mx-4 my-1" />

          {/* Stash */}
          <div className="flex items-center justify-between px-4 py-2">
            <button
              onClick={() => setShowStashes(!showStashes)}
              className="flex items-center gap-1.5 text-[11px] font-bold text-[#707070] tracking-[0.1em] uppercase hover:text-[#d4d4d4] transition-colors"
            >
              <Archive size={11} />
              Stash
              {stashes.length > 0 && (
                <span className="bg-[#007acc] text-white text-[10px] px-1.5 rounded-full">{stashes.length}</span>
              )}
              <ChevronDown size={10} className={`transition-transform ${showStashes ? 'rotate-180' : ''}`} />
            </button>
            <button
              onClick={() => setShowStashInput(!showStashInput)}
              className="text-[#969696] hover:text-[#d4d4d4] transition-colors"
            >
              <Plus size={13} />
            </button>
          </div>

          <AnimatePresence>
            {showStashInput && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden px-4 pb-2"
              >
                <input
                  autoFocus
                  type="text"
                  value={newStashName}
                  onChange={e => setNewStashName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleNewStash();
                    if (e.key === 'Escape') { setShowStashInput(false); setNewStashName(''); }
                  }}
                  placeholder="Stash name..."
                  className="w-full bg-[#1e1e1e] border border-[#333] px-3 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#007acc]/40 rounded-md"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showStashes && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                {stashes.length === 0 ? (
                  <div className="px-5 py-2 text-[11px] text-[#555] italic">No stashes</div>
                ) : (
                  stashes.map(entry => (
                    <div key={entry.index} className="flex items-center gap-2 px-4 py-2 hover:bg-[#2a2d2e] group border-b border-[#2a2a2a]">
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] text-[#d4d4d4] truncate">{entry.name}</div>
                        <div className="text-[10px] text-[#646464]">{entry.branch} · {entry.date}</div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handlePopStash(entry)} title="Pop" className="p-1 text-[#969696] hover:text-[#4ec9b0]">
                          <RotateCcw size={12} />
                        </button>
                        <button onClick={() => handleDropStash(entry)} title="Drop" className="p-1 text-[#969696] hover:text-[#f48771]">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="h-px bg-[#333] mx-4 my-1" />

          {/* Timeline */}
          <SectionTitle>Timeline</SectionTitle>
          <div className="mx-4 pb-4 space-y-0.5 overflow-y-auto max-h-[160px]">
            {snapshots.length === 0 ? (
              <div className="py-2 text-[11px] text-[#555] italic">No snapshots yet</div>
            ) : (
              [...snapshots].reverse().map(snap => (
                <div key={snap.hash} className="flex gap-3 text-[11px] hover:bg-[#2a2d2e] p-2 rounded-md transition-colors cursor-default">
                  <span className="text-[#646464] shrink-0 font-mono italic">{snap.date?.slice(11, 16) || snap.date}</span>
                  <span className="text-[#cccccc] flex-1 line-clamp-1">{snap.message}</span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* ── Right: Output Console ── */}
        <section className="flex-1 bg-[#1e1e1e] flex flex-col shadow-2xl relative min-w-0">
          <div className="h-9 bg-[#2d2d2d] flex items-center px-4 justify-between shrink-0 border-b border-[#141414]">
            <div className="flex items-center gap-2.5">
              <Terminal size={14} className="text-[#808080]" />
              <span className="text-[10px] font-black text-[#808080] uppercase tracking-[0.2em]">Output Console</span>
            </div>
            <button
              onClick={clearLogs}
              className="px-3 py-1 hover:bg-[#3c3c3c] transition-colors text-[10px] font-bold text-[#969696] hover:text-white rounded-md uppercase"
            >
              Clear
            </button>
          </div>

          <div className="flex-1 overflow-auto p-6 font-mono text-[12.5px] leading-[1.7] selection:bg-[#264f78]/60">
            <AnimatePresence initial={false}>
              {logs.length === 0 && (
                <div className="text-[#444] italic text-[12px]">Waiting for operations...</div>
              )}
              {logs.map((log, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.12 }}
                  className={`py-0.5 border-l-2 border-transparent pl-4 -ml-4 ${
                    log.includes('[ERROR]')   ? 'text-[#f48771] bg-[#f48771]/5 border-[#f48771]' :
                    log.includes('[WARN]')    ? 'text-[#cca700] bg-[#cca700]/5 border-[#cca700]' :
                    log.includes('[OK]')      ? 'text-[#4ec9b0] bg-[#4ec9b0]/5 border-[#4ec9b0]' :
                    log.includes('[INFO]')    ? 'text-[#9cdcfe]' :
                    'text-[#d4d4d4]'
                  }`}
                >
                  <span className="opacity-30 mr-3 select-none text-[10px]">{idx + 1}</span>
                  {log}
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={logEndRef} />
          </div>

          {/* Conflict floating button */}
          <div className="absolute bottom-10 right-10 pointer-events-none">
            <AnimatePresence>
              {logs.some(l => l.includes('[WARN]') && l.includes('冲突')) && (
                <motion.button
                  initial={{ y: 50, opacity: 0, scale: 0.9 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: 50, opacity: 0, scale: 0.9 }}
                  onClick={() => api.submitConfirm()}
                  className="pointer-events-auto bg-[#007acc] hover:bg-[#1c91ea] text-white font-bold py-4 px-8 rounded-xl shadow-[0_20px_50px_rgba(0,122,204,0.3)] flex items-center gap-4 transition-all active:scale-95 border border-white/20"
                >
                  <AlertCircle size={20} />
                  Resolve Done — Continue
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </section>
      </main>

      {/* ── Status Bar ── */}
      <footer className="h-7 bg-[#007acc] text-white flex items-center px-4 justify-between text-[11px] shrink-0 font-medium select-none">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2 hover:bg-white/10 px-2 -mx-2 h-full transition-colors cursor-pointer">
            <GitBranch size={13} className="opacity-80" />
            <span>{status?.branch || stream || '—'}</span>
          </div>
          <div className="flex items-center gap-2 hover:bg-white/10 px-2 -mx-2 h-full transition-colors cursor-pointer">
            <RefreshCcw size={13} className="opacity-80" />
            <span>{changes.length} Pending Changes</span>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="hover:bg-white/10 px-2 -mx-2 h-full transition-colors cursor-pointer">UTF-8</div>
          <div className="hover:bg-white/10 px-2 -mx-2 h-full transition-colors cursor-pointer">
            {stream ? `P4Git · ${stream}` : 'P4Git Tool'}
          </div>
        </div>
      </footer>

      {/* Config Dialog */}
      {showConfig && <ConfigDialog onClose={() => setShowConfig(false)} />}
    </div>
  );
}
