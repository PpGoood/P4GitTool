import { create } from 'zustand';
import {
  api, FileChange, SnapshotEntry, StreamStatus, P4GitConfig, DiffFile,
} from '../api/client';

interface WorkspaceState {
  status: StreamStatus | null;
  changes: FileChange[];
  snapshots: SnapshotEntry[];
  selectedFile: string | null;
  diff: DiffFile | null;
}

const EMPTY_WS: WorkspaceState = {
  status: null,
  changes: [],
  snapshots: [],
  selectedFile: null,
  diff: null,
};

interface AppState {
  // 全局
  config: P4GitConfig | null;
  currentStream: string;
  workspaces: Record<string, WorkspaceState>;

  // 日志
  logs: string[];

  // UI
  timelineCollapsed: boolean;
  logCollapsed: boolean;
  isLoading: boolean;
  loadingOp: string | null;

  // 全局 actions
  setCurrentStream: (stream: string) => void;
  toggleTimeline: () => void;
  toggleLog: () => void;
  appendLog: (line: string) => void;
  clearLogs: () => void;

  // 配置
  loadConfig: () => Promise<void>;
  saveConfig: (cfg: P4GitConfig) => Promise<void>;

  // 数据刷新
  refreshStatus: (stream: string) => Promise<void>;
  refreshChanges: (stream: string) => Promise<void>;
  refreshSnapshots: (stream: string) => Promise<void>;
  refreshDiff: (stream: string, filepath: string | null) => Promise<void>;
  refreshWorkspace: (stream: string) => Promise<void>;

  // 文件选择
  selectFile: (stream: string, filepath: string | null) => Promise<void>;

  // 操作
  runInit: () => Promise<void>;
  runPull: (scope?: string, mode?: string) => Promise<void>;
  runSnapshot: (message: string) => Promise<boolean>;
  runCheckUpdate: () => Promise<'ready' | 'outdated' | 'error'>;
  runSubmitPrepare: () => Promise<void>;
  runSubmitConfirm: () => Promise<void>;
  runDiscardFile: (filepath: string) => Promise<boolean>;
  runDiscardHunk: (filepath: string, hunkIndex: number) => Promise<boolean>;
  runDiscardLine: (filepath: string, hunkIndex: number, lineIndex: number) => Promise<boolean>;
  runRollback: (hash: string) => Promise<boolean>;

  // 内部
  patchWorkspace: (stream: string, patch: Partial<WorkspaceState>) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  config: null,
  currentStream: '',
  workspaces: {},
  logs: [],
  timelineCollapsed: false,
  logCollapsed: true,
  isLoading: false,
  loadingOp: null,

  setCurrentStream: (stream) => {
    set({ currentStream: stream });
    get().refreshWorkspace(stream);
  },

  toggleTimeline: () => set((s) => ({ timelineCollapsed: !s.timelineCollapsed })),
  toggleLog: () => set((s) => ({ logCollapsed: !s.logCollapsed })),

  appendLog: (line) => set((s) => ({
    logs: [...s.logs.slice(-500), line],
    logCollapsed: /\[ERROR\]/i.test(line) ? false : s.logCollapsed,
  })),

  clearLogs: () => set({ logs: [] }),

  patchWorkspace: (stream, patch) => set((s) => ({
    workspaces: {
      ...s.workspaces,
      [stream]: { ...(s.workspaces[stream] ?? EMPTY_WS), ...patch },
    },
  })),

  loadConfig: async () => {
    try {
      const config = await api.getConfig();
      set({ config });
      if (!get().currentStream && config.streams.length > 0) {
        get().setCurrentStream(config.streams[0].name);
      }
    } catch {}
  },

  saveConfig: async (cfg) => {
    await api.saveConfig(cfg);
    set({ config: cfg });
    get().appendLog('[OK] 配置已保存');
  },

  refreshStatus: async (stream) => {
    try {
      const status = await api.getStatus(stream);
      get().patchWorkspace(stream, { status });
    } catch {}
  },

  refreshChanges: async (stream) => {
    try {
      const { files } = await api.getChanges(stream);
      get().patchWorkspace(stream, { changes: files });
      const ws = get().workspaces[stream];
      if (ws?.selectedFile && !files.some((f) => f.path === ws.selectedFile)) {
        get().patchWorkspace(stream, { selectedFile: null, diff: null });
      }
    } catch {}
  },

  refreshSnapshots: async (stream) => {
    try {
      const { snapshots } = await api.getSnapshots(stream);
      get().patchWorkspace(stream, { snapshots });
    } catch {}
  },

  refreshDiff: async (stream, filepath) => {
    if (!filepath) {
      get().patchWorkspace(stream, { diff: null });
      return;
    }
    try {
      const { diff } = await api.getDiff(stream, filepath);
      get().patchWorkspace(stream, { diff });
    } catch {
      get().patchWorkspace(stream, { diff: null });
    }
  },

  refreshWorkspace: async (stream) => {
    if (!stream) return;
    await Promise.all([
      get().refreshStatus(stream),
      get().refreshChanges(stream),
      get().refreshSnapshots(stream),
    ]);
    const ws = get().workspaces[stream];
    if (ws?.selectedFile) {
      await get().refreshDiff(stream, ws.selectedFile);
    }
  },

  selectFile: async (stream, filepath) => {
    get().patchWorkspace(stream, { selectedFile: filepath });
    await get().refreshDiff(stream, filepath);
  },

  runInit: async () => {
    set({ isLoading: true, loadingOp: 'init' });
    get().clearLogs();
    try {
      await api.init();
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },

  runPull: async (scope = 'all', mode = 'standard') => {
    const s = get().currentStream;
    if (!s) return;
    set({ isLoading: true, loadingOp: 'pull' });
    try {
      await api.pull(s, scope, mode);
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },

  runSnapshot: async (message) => {
    const s = get().currentStream;
    if (!s) return false;
    set({ isLoading: true, loadingOp: 'snapshot' });
    try {
      const { ok } = await api.snapshot(s, message);
      if (ok) await get().refreshWorkspace(s);
      return ok;
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },

  runCheckUpdate: async () => {
    const s = get().currentStream;
    if (!s) return 'error' as const;
    set({ isLoading: true, loadingOp: 'check-update' });
    try {
      const { status } = await api.checkUpdate(s);
      return status;
    } catch {
      return 'error' as const;
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },

  runSubmitPrepare: async () => {
    const s = get().currentStream;
    if (!s) return;
    set({ isLoading: true, loadingOp: 'submit-prepare' });
    try {
      await api.submitPrepare(s);
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },

  runSubmitConfirm: async () => {
    const s = get().currentStream;
    if (!s) return;
    set({ isLoading: true, loadingOp: 'submit-confirm' });
    try {
      await api.submitConfirm(s);
      await get().refreshWorkspace(s);
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },

  runDiscardFile: async (filepath) => {
    const s = get().currentStream;
    if (!s) return false;
    const { ok } = await api.discardFile(s, filepath);
    if (ok) await get().refreshWorkspace(s);
    return ok;
  },

  runDiscardHunk: async (filepath, hunkIndex) => {
    const s = get().currentStream;
    if (!s) return false;
    const { ok } = await api.discardHunk(s, filepath, hunkIndex);
    if (ok) await get().refreshWorkspace(s);
    return ok;
  },

  runDiscardLine: async (filepath, hunkIndex, lineIndex) => {
    const s = get().currentStream;
    if (!s) return false;
    const { ok } = await api.discardLine(s, filepath, hunkIndex, lineIndex);
    if (ok) await get().refreshWorkspace(s);
    return ok;
  },

  runRollback: async (hash) => {
    const s = get().currentStream;
    if (!s) return false;
    set({ isLoading: true, loadingOp: 'rollback' });
    try {
      const { ok } = await api.rollback(s, hash);
      if (ok) await get().refreshWorkspace(s);
      return ok;
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },
}));

// helper: 取当前工作区的数据
export function useCurrentWorkspace(): WorkspaceState {
  return useAppStore((s) => s.workspaces[s.currentStream] ?? EMPTY_WS);
}
