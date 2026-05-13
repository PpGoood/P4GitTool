import { create } from 'zustand';
import {
  api, FileChange, SnapshotEntry, StreamStatus, P4GitConfig, DiffFile,
  SubmitPrepareResult,
} from '../api/client';

// -------------------------------------------------------
// 视图模式 discriminated union（CR-12）
// -------------------------------------------------------

export type ViewMode =
  | { kind: 'normal' }
  | { kind: 'detached' }
  | { kind: 'viewing'; node: SnapshotEntry }
  | { kind: 'conflict'; files: string[] };

export const VIEW_NORMAL: ViewMode = { kind: 'normal' };
export const VIEW_DETACHED: ViewMode = { kind: 'detached' };

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
  isDetached: boolean;
  // 历史节点查看模式（纯读，不改变工作区）
  viewingNode: SnapshotEntry | null;
  viewingFiles: FileChange[];
  viewingDiff: DiffFile | null;
  viewingSelectedFile: string | null;
  // 统一视图模式（CR-12）：组件优先读这个，旧字段保留兼容
  viewMode: ViewMode;

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
  runAlignGit: () => Promise<void>;
  runAlignGitContinue: (resolution: 'ours' | 'theirs' | 'manual') => Promise<void>;
  runSnapshot: (message: string) => Promise<boolean>;
  runCheckUpdate: () => Promise<'ready' | 'outdated' | 'error'>;
  runSubmitPrepare: () => Promise<SubmitPrepareResult>;
  runDiscardFile: (filepath: string) => Promise<boolean>;
  runDiscardHunk: (filepath: string, hunkIndex: number) => Promise<boolean>;
  runDiscardLine: (filepath: string, hunkIndex: number, lineIndex: number) => Promise<boolean>;
  runRollback: (hash: string) => Promise<boolean>;
  runCheckoutNode: (hash: string) => Promise<boolean>;
  runReturnLatest: (force?: boolean) => Promise<{ ok: boolean; hasChanges?: boolean; changes?: FileChange[] }>;
  // 历史节点查看
  viewNode: (snapshot: SnapshotEntry) => Promise<void>;
  viewNodeSelectFile: (filepath: string) => Promise<void>;
  exitNodeView: () => void;

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
  isDetached: false,
  viewingNode: null,
  viewingFiles: [],
  viewingDiff: null,
  viewingSelectedFile: null,
  viewMode: VIEW_NORMAL,

  setCurrentStream: (stream) => {
    set({
      currentStream: stream,
      // 切换 Tab 时重置跨 workspace 的状态，避免残留
      isDetached: false,
      viewingNode: null,
      viewingFiles: [],
      viewingDiff: null,
      viewingSelectedFile: null,
      viewMode: VIEW_NORMAL,
    });
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
    // 重试最多 5 次，每次间隔 600ms，等待 Express 服务器就绪
    for (let i = 0; i < 5; i++) {
      try {
        const config = await api.getConfig();
        set({ config });
        if (!get().currentStream && config.streams.length > 0) {
          get().setCurrentStream(config.streams[0].name);
        }
        return;
      } catch {
        if (i < 4) await new Promise(r => setTimeout(r, 600));
      }
    }
  },

  saveConfig: async (cfg) => {
    try {
      await api.saveConfig(cfg);
      set({ config: cfg });
      get().appendLog('[OK] 配置已保存');
      // 保存后自动切换到第一个工作区
      if (cfg.streams.length > 0) {
        get().setCurrentStream(cfg.streams[0].name);
      }
    } catch (e: any) {
      get().appendLog(`[ERROR] 配置保存失败: ${e.message}`);
    }
  },

  refreshStatus: async (stream) => {
    try {
      const status = await api.getStatus(stream);
      get().patchWorkspace(stream, { status });
      if (stream === get().currentStream) {
        const detached = status.isDetached ?? false;
        set({ isDetached: detached });
        // 检测到 merge 冲突状态，自动弹出冲突弹窗
        if (status.inMergeConflict && status.mergeConflictFiles?.length > 0) {
          set({
            viewMode: { kind: 'conflict', files: status.mergeConflictFiles },
          });
        } else if (detached) {
          set({ viewMode: VIEW_DETACHED });
        } else {
          // 只在 normal 时重置，避免覆盖 viewing 模式
          const cur = get().viewMode;
          if (cur.kind !== 'viewing') set({ viewMode: VIEW_NORMAL });
        }
      }
    } catch (e: any) {
      get().appendLog(`[ERROR] 获取 ${stream} 状态失败: ${e?.message ?? e}`);
    }
  },

  refreshChanges: async (stream) => {
    try {
      const { files } = await api.getChanges(stream);
      get().patchWorkspace(stream, { changes: files });
      const ws = get().workspaces[stream];
      if (ws?.selectedFile && !files.some((f) => f.path === ws.selectedFile)) {
        get().patchWorkspace(stream, { selectedFile: null, diff: null });
      }
    } catch (e: any) {
      get().appendLog(`[ERROR] 获取 ${stream} 改动列表失败: ${e?.message ?? e}`);
    }
  },

  refreshSnapshots: async (stream) => {
    try {
      const { snapshots } = await api.getSnapshots(stream);
      get().patchWorkspace(stream, { snapshots });
    } catch (e: any) {
      get().appendLog(`[ERROR] 获取 ${stream} 快照列表失败: ${e?.message ?? e}`);
    }
  },

  refreshDiff: async (stream, filepath) => {
    if (!filepath) {
      get().patchWorkspace(stream, { diff: null });
      return;
    }
    try {
      const { diff } = await api.getDiff(stream, filepath);
      get().patchWorkspace(stream, { diff });
    } catch (e: any) {
      get().patchWorkspace(stream, { diff: null });
      get().appendLog(`[ERROR] 获取 ${filepath} diff 失败: ${e?.message ?? e}`);
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
      // Init 完成后自动刷新所有工作区状态
      const s = get().currentStream;
      if (s) await get().refreshWorkspace(s);
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
      await get().refreshWorkspace(s);
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },

  runAlignGit: async () => {
    const s = get().currentStream;
    if (!s) return;
    set({ isLoading: true, loadingOp: 'align-git' });
    try {
      const result = await api.alignGit(s);
      if (result.ok) {
        await get().refreshWorkspace(s);
      } else if (result.conflicts && result.conflicts.length > 0) {
        set({
          viewMode: { kind: 'conflict', files: result.conflicts },
        });
      }
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },

  runAlignGitContinue: async (resolution) => {
    const s = get().currentStream;
    if (!s) return;
    set({ isLoading: true, loadingOp: 'align-git', viewMode: VIEW_NORMAL });
    try {
      const result = await api.alignGitContinue(s, resolution);
      if (result.ok) {
        await get().refreshWorkspace(s);
      }
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
    if (!s) return { ok: false, reason: 'stream-not-found' };
    set({ isLoading: true, loadingOp: 'submit-prepare' });
    try {
      const result = await api.submitPrepare(s);
      // 提交成功后刷新快照时间线（显示绿色节点）
      if (result.ok) {
        await get().refreshSnapshots(s);
      }
      return result;
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },

  runDiscardFile: async (filepath) => {
    const s = get().currentStream;
    if (!s) return false;
    const { ok } = await api.discardFile(s, filepath);
    if (ok) {
      await get().refreshChanges(s);
      // 如果当前选中的就是这个文件，清除 diff
      const ws = get().workspaces[s];
      if (ws?.selectedFile === filepath) {
        get().patchWorkspace(s, { selectedFile: null, diff: null });
      }
    }
    return ok;
  },

  runDiscardHunk: async (filepath, hunkIndex) => {
    const s = get().currentStream;
    if (!s) return false;
    const { ok } = await api.discardHunk(s, filepath, hunkIndex);
    if (ok) {
      // 只刷新 changes 和当前文件的 diff，不刷新 snapshots/status
      await Promise.all([
        get().refreshChanges(s),
        get().refreshDiff(s, filepath),
      ]);
    }
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
    // RollbackDialog 用这个来 checkout 到历史节点（viewNode 模式）
    // 实际逻辑复用 runCheckoutNode
    return get().runCheckoutNode(hash);
  },

  runCheckoutNode: async (hash) => {
    const s = get().currentStream;
    if (!s) return false;
    set({ isLoading: true, loadingOp: 'checkout' });
    try {
      const { ok } = await api.checkoutNode(s, hash);
      if (ok) {
        const status = await api.getStatus(s);
        get().patchWorkspace(s, { status, changes: [] });
        if (s === get().currentStream) {
          const detached = status.isDetached ?? false;
          set({
            isDetached: detached,
            viewMode: detached ? VIEW_DETACHED : VIEW_NORMAL,
          });
        }
        if (!status.isDetached) {
          get().exitNodeView();
        }
      }
      return ok;
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },

  runReturnLatest: async (force = false) => {
    const s = get().currentStream;
    if (!s) return { ok: false } as any;
    set({ isLoading: true, loadingOp: 'return-latest' });
    try {
      const result = await api.returnLatest(s, force);
      if (result.ok) {
        set({ isDetached: false, viewMode: VIEW_NORMAL });
        get().exitNodeView();
        await get().refreshWorkspace(s);
      }
      return result;
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },

  viewNode: async (snapshot) => {
    const s = get().currentStream;
    if (!s) return;
    set({
      viewingNode: snapshot,
      viewingFiles: [],
      viewingDiff: null,
      viewingSelectedFile: null,
      viewMode: { kind: 'viewing', node: snapshot },
      isLoading: true,
      loadingOp: 'view-node',
    });
    try {
      const { files } = await api.getNodeFiles(s, snapshot.hash, snapshot.parentHash);
      set({ viewingFiles: files });
    } catch {} finally {
      set({ isLoading: false, loadingOp: null });
    }
  },

  viewNodeSelectFile: async (filepath) => {
    const s = get().currentStream;
    const node = get().viewingNode;
    if (!s || !node) return;
    set({ viewingSelectedFile: filepath, viewingDiff: null });
    try {
      const { diff } = await api.getNodeDiff(s, node.hash, node.parentHash, filepath);
      set({ viewingDiff: diff });
    } catch {}
  },

  exitNodeView: () => {
    set({
      viewingNode: null,
      viewingFiles: [],
      viewingDiff: null,
      viewingSelectedFile: null,
      viewMode: get().isDetached ? VIEW_DETACHED : VIEW_NORMAL,
    });
  },
}));

// helper: 取当前工作区的数据
export function useCurrentWorkspace(): WorkspaceState {
  return useAppStore((s) => s.workspaces[s.currentStream] ?? EMPTY_WS);
}
