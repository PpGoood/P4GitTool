import { create } from 'zustand';
import { api, FileChange, Snapshot, StashEntry, StreamStatus, P4GitConfig } from '../api/client';

interface AppState {
  // 配置
  config: P4GitConfig | null;

  // 工作区
  stream: string;
  status: StreamStatus | null;

  // 改动文件
  changes: FileChange[];

  // 快照
  snapshots: Snapshot[];

  // Stash
  stashes: StashEntry[];

  // 日志
  logs: string[];

  // UI 状态
  isLoading: boolean;
  activePanel: 'changes' | 'stashes' | 'log';

  // Actions
  setStream: (stream: string) => void;
  setActivePanel: (panel: 'changes' | 'stashes' | 'log') => void;
  appendLog: (line: string) => void;
  clearLogs: () => void;

  // 数据刷新
  refreshStatus: () => Promise<void>;
  refreshChanges: () => Promise<void>;
  refreshSnapshots: () => Promise<void>;
  refreshStashes: () => Promise<void>;
  refreshAll: () => Promise<void>;
  loadConfig: () => Promise<void>;
  saveConfig: (cfg: P4GitConfig) => Promise<void>;

  // 操作
  runInit: () => Promise<void>;
  runPull: (scope?: string, mode?: string) => Promise<void>;
  runCheckAndUpdate: () => Promise<void>;
  runSubmitPrepare: () => Promise<void>;
  runSubmitConfirm: () => Promise<void>;
  runCreateSnapshot: (message: string) => Promise<boolean>;
  runCreateStash: (name: string) => Promise<boolean>;
  runPopStash: (index: number) => Promise<boolean>;
  runDropStash: (index: number) => Promise<boolean>;
}

export const useAppStore = create<AppState>((set, get) => ({
  config: null,
  stream: '',
  status: null,
  changes: [],
  snapshots: [],
  stashes: [],
  logs: [],
  isLoading: false,
  activePanel: 'changes',

  setStream: (stream) => {
    set({ stream });
    get().refreshAll();
  },

  setActivePanel: (panel) => set({ activePanel: panel }),

  appendLog: (line) => set((s) => ({ logs: [...s.logs.slice(-500), line] })),

  clearLogs: () => set({ logs: [] }),

  refreshStatus: async () => {
    const { stream } = get();
    if (!stream) return;
    try {
      const status = await api.getStatus(stream);
      set({ status });
    } catch {}
  },

  refreshChanges: async () => {
    const { stream } = get();
    if (!stream) return;
    try {
      const { files } = await api.getChanges(stream);
      set({ changes: files });
    } catch {}
  },

  refreshSnapshots: async () => {
    const { stream } = get();
    if (!stream) return;
    try {
      const { snapshots } = await api.getSnapshots(stream);
      set({ snapshots });
    } catch {}
  },

  refreshStashes: async () => {
    const { stream, status } = get();
    if (!stream || !status?.branch) return;
    try {
      const { stashes } = await api.getStashes(stream, status.branch);
      set({ stashes });
    } catch {}
  },

  refreshAll: async () => {
    await get().refreshStatus();
    await Promise.all([
      get().refreshChanges(),
      get().refreshSnapshots(),
      get().refreshStashes(),
    ]);
  },

  loadConfig: async () => {
    try {
      const config = await api.getConfig();
      set({ config });
      if (!get().stream && config.streams.length > 0) {
        get().setStream(config.streams[0].name);
      }
    } catch {}
  },

  saveConfig: async (cfg) => {
    await api.saveConfig(cfg);
    set({ config: cfg });
    get().appendLog('[OK] 配置已保存');
  },

  runInit: async () => {
    set({ isLoading: true });
    get().clearLogs();
    try {
      await api.init();
      setTimeout(() => get().refreshAll(), 2000);
    } finally {
      set({ isLoading: false });
    }
  },

  runPull: async (scope = 'all', mode = 'standard') => {
    const { stream } = get();
    if (!stream) return;
    set({ isLoading: true });
    get().clearLogs();
    try {
      await api.pull(stream, scope, mode);
      setTimeout(() => get().refreshAll(), 1000);
    } finally {
      set({ isLoading: false });
    }
  },

  runCheckAndUpdate: async () => {
    const { stream } = get();
    if (!stream) return;
    set({ isLoading: true });
    get().clearLogs();
    try {
      await api.checkAndUpdate(stream);
      setTimeout(() => get().refreshAll(), 1000);
    } finally {
      set({ isLoading: false });
    }
  },

  runSubmitPrepare: async () => {
    const { stream } = get();
    if (!stream) return;
    set({ isLoading: true });
    get().clearLogs();
    try {
      await api.submitPrepare(stream);
      setTimeout(() => get().refreshStatus(), 1000);
    } finally {
      set({ isLoading: false });
    }
  },

  runSubmitConfirm: async () => {
    set({ isLoading: true });
    get().clearLogs();
    try {
      await api.submitConfirm();
      setTimeout(() => get().refreshAll(), 1000);
    } finally {
      set({ isLoading: false });
    }
  },

  runCreateSnapshot: async (message) => {
    const { stream } = get();
    if (!stream) return false;
    try {
      const { ok } = await api.createSnapshot(stream, message);
      if (ok) {
        await get().refreshChanges();
        await get().refreshSnapshots();
      }
      return ok;
    } catch {
      return false;
    }
  },

  runCreateStash: async (name) => {
    const { stream } = get();
    if (!stream) return false;
    try {
      const { ok } = await api.createStash(stream, name);
      if (ok) {
        await get().refreshChanges();
        await get().refreshStashes();
      }
      return ok;
    } catch {
      return false;
    }
  },

  runPopStash: async (index) => {
    const { stream } = get();
    if (!stream) return false;
    try {
      const { ok } = await api.popStash(stream, index);
      if (ok) {
        await get().refreshChanges();
        await get().refreshStashes();
      }
      return ok;
    } catch {
      return false;
    }
  },

  runDropStash: async (index) => {
    const { stream } = get();
    if (!stream) return false;
    try {
      const { ok } = await api.dropStash(stream, index);
      if (ok) await get().refreshStashes();
      return ok;
    } catch {
      return false;
    }
  },
}));
