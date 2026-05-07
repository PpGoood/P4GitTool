# P4Git Tool 重构 — 计划3：前端 UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构前端 React UI，实现设计文档中的完整界面：顶部 Tab、文件列表 + 操作按钮、diff 面板（hunk/line discard）、时间线、操作日志、状态栏。

**Architecture:** 保持 React 19 + Zustand + Tailwind 技术栈。App.tsx 精简为布局容器，各区域拆分为独立组件。新增 `useEventStream` hook 订阅 `/api/events` 统一事件流，自动刷新对应数据。

**Tech Stack:** React 19, Zustand 5, Tailwind 4, lucide-react, motion

**前置条件：Plan 1 + Plan 2 已完成。** 所有后端 API 已就绪。

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | `src/api/client.ts` | 新增 diff/discard/rollback/snapshot API，删除 stash |
| 修改 | `src/store/appStore.ts` | 重构 state：按工作区分组，新增 snapshots、selectedFile、diff |
| 新增 | `src/hooks/useEventStream.ts` | 订阅 /api/events 的 hook |
| 新增 | `src/components/TabBar.tsx` | 顶部 Tab 栏 |
| 新增 | `src/components/FileList.tsx` | 文件列表（含右键菜单） |
| 新增 | `src/components/DiffPanel.tsx` | Diff 面板（hunk/line discard） |
| 新增 | `src/components/Timeline.tsx` | 横向时间线 |
| 新增 | `src/components/LogPanel.tsx`（重写） | 日志面板（可折叠） |
| 新增 | `src/components/StatusBar.tsx` | 底部状态栏 |
| 新增 | `src/components/SnapshotDialog.tsx` | 提交快照对话框 |
| 新增 | `src/components/RollbackDialog.tsx` | 回滚确认对话框 |
| 修改 | `src/components/ConfigDialog.tsx` | 无需大改，只需确保能触发 store 刷新 |
| 修改 | `src/App.tsx` | 精简为布局容器 |
| 删除 | `src/components/StashPanel.tsx` | 删除 |
| 删除 | `src/components/ChangesPanel.tsx` | 删除（逻辑移入 FileList） |

---

## Task 0: 更新 api/client.ts

新增 diff、discard、rollback、snapshot 的客户端方法，删除 stash 相关。

**Files:**
- Modify: `P4GitTool.Electron/src/api/client.ts`

- [ ] **Step 1: 完整替换 client.ts**

Replace `P4GitTool.Electron/src/api/client.ts` with:

```typescript
// 获取 API 端口（Electron 注入，开发模式用固定端口）
function getBaseUrl(): string {
  if (typeof window !== 'undefined' && (window as any).electron) {
    return `http://127.0.0.1:${(window as any).electron.apiPort()}`;
  }
  return 'http://127.0.0.1:3001';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getBaseUrl()}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface StreamStatus {
  gitInited: boolean;
  junctionOk: boolean;
  branch: string;
  branches: string[];
  pendingSubmit: boolean;
}

export interface FileChange {
  status: string;
  path: string;
}

export interface SnapshotEntry {
  hash: string;
  parentHash: string;
  date: string;
  message: string;
  kind: 'sync' | 'sync-protect' | 'manual' | 'submit' | 'other';
  fileCount: number;
}

export interface DiffLine {
  type: 'ctx' | 'add' | 'del';
  content: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
}

export interface P4GitConfig {
  p4_port: string;
  p4_user: string;
  streams: { name: string; client: string; root: string }[];
}

export type AppEvent =
  | { type: 'log'; line: string }
  | { type: 'files-changed'; stream: string }
  | { type: 'op-done'; op: string; stream: string; ok: boolean; detail?: string };

// -------------------------------------------------------
// API
// -------------------------------------------------------

export const api = {
  // 配置
  getConfig: () => get<P4GitConfig>('/config'),
  saveConfig: (cfg: P4GitConfig) => post<{ ok: boolean }>('/config', cfg),

  // 状态
  getStatus: (stream: string) =>
    get<StreamStatus>(`/status?stream=${encodeURIComponent(stream)}`),

  // 改动文件
  getChanges: (stream: string) =>
    get<{ files: FileChange[] }>(`/changes?stream=${encodeURIComponent(stream)}`),

  // Diff
  getDiff: (stream: string, filepath: string) =>
    get<{ diff: DiffFile | null }>(
      `/diff?stream=${encodeURIComponent(stream)}&path=${encodeURIComponent(filepath)}`
    ),

  // 快照列表
  getSnapshots: (stream: string, limit = 100) =>
    get<{ snapshots: SnapshotEntry[] }>(
      `/snapshots?stream=${encodeURIComponent(stream)}&limit=${limit}`
    ),

  // 操作
  init: () => post<{ ok: boolean }>('/init'),
  pull: (stream: string, scope = 'all', mode = 'standard') =>
    post<{ ok: boolean }>('/pull', { stream, scope, mode }),
  snapshot: (stream: string, message: string) =>
    post<{ ok: boolean }>('/snapshot', { stream, message }),
  checkUpdate: (stream: string) =>
    post<{ status: 'ready' | 'outdated' | 'error' }>('/check-update', { stream }),
  submitPrepare: (stream: string) => post<{ ok: boolean }>('/submit-prepare', { stream }),
  submitConfirm: (stream: string) => post<{ ok: boolean }>('/submit-confirm', { stream }),

  // Discard
  discardFile: (stream: string, path: string) =>
    post<{ ok: boolean }>('/discard-file', { stream, path }),
  discardHunk: (stream: string, path: string, hunkIndex: number) =>
    post<{ ok: boolean }>('/discard-hunk', { stream, path, hunkIndex }),
  discardLine: (stream: string, path: string, hunkIndex: number, lineIndex: number) =>
    post<{ ok: boolean }>('/discard-line', { stream, path, hunkIndex, lineIndex }),

  // Rollback
  rollback: (stream: string, hash: string) =>
    post<{ ok: boolean }>('/rollback', { stream, hash }),

  // SSE 统一事件流
  subscribeEvents: (onEvent: (e: AppEvent) => void): (() => void) => {
    const es = new EventSource(`${getBaseUrl()}/api/events`);
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        onEvent(data);
      } catch {
        // 忽略非 JSON 行
      }
    };
    return () => es.close();
  },
};
```

- [ ] **Step 2: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/src/api/client.ts
git commit -m "refactor: api/client 支持 diff/discard/rollback，删除 stash"
```

---

## Task 1: 重构 store/appStore.ts

状态按工作区分组：每个 stream 独立维护 status、changes、snapshots、selectedFile、diff。同时支持 UI 全局状态：currentStream、logs、panelState（日志/时间线折叠状态）。

**Files:**
- Modify: `P4GitTool.Electron/src/store/appStore.ts`

- [ ] **Step 1: 完整替换 appStore.ts**

Replace `P4GitTool.Electron/src/store/appStore.ts` with:

```typescript
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
  loadingOp: string | null;  // 当前正在执行的操作名

  // 全局 actions
  setCurrentStream: (stream: string) => void;
  toggleTimeline: () => void;
  toggleLog: () => void;
  appendLog: (line: string) => void;
  clearLogs: () => void;

  // 配置
  loadConfig: () => Promise<void>;
  saveConfig: (cfg: P4GitConfig) => Promise<void>;

  // 数据刷新（针对某个 stream）
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

  // 内部：更新单个 workspace
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
    // 出现 ERROR 时自动展开日志
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
      // 若选中文件已不在 changes 里，清除选中
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

  // ------------------ 操作 ------------------

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
```

- [ ] **Step 2: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

Expected: `App.tsx` 和 `StashPanel.tsx` 等会报错（它们引用了被删除的旧 state），这是预期的，后续 Task 会处理。

记录错误列表，后续 Task 结束时应全部消失。

- [ ] **Step 3: 提交（即使有 lint 错误，store 本身编译应该通过；若 store 本身有错必须先修复）**

```bash
cd P4GitTool.Electron && tsc --noEmit src/store/appStore.ts
```

如 store 本身无错，即使全局 lint 报错也可提交：

```bash
git add P4GitTool.Electron/src/store/appStore.ts
git commit -m "refactor: appStore 按 workspace 分组，新增 snapshots/diff"
```

---

## Task 2: useEventStream hook

订阅 `/api/events` 的 React hook。根据事件类型自动触发对应数据刷新。

**Files:**
- Create: `P4GitTool.Electron/src/hooks/useEventStream.ts`

- [ ] **Step 1: 创建 hooks 目录并实现**

```bash
cd P4GitTool.Electron && mkdir -p src/hooks
```

Create: `P4GitTool.Electron/src/hooks/useEventStream.ts`

```typescript
import { useEffect } from 'react';
import { api, AppEvent } from '../api/client';
import { useAppStore } from '../store/appStore';

/**
 * 订阅后端 /api/events 统一事件流，自动触发数据刷新。
 * - log 事件 → 追加到日志
 * - files-changed 事件 → 刷新对应 stream 的 changes
 * - op-done 事件 → 刷新该 stream 全部数据
 */
export function useEventStream(): void {
  useEffect(() => {
    const unsub = api.subscribeEvents((e: AppEvent) => {
      const store = useAppStore.getState();

      switch (e.type) {
        case 'log':
          store.appendLog(e.line);
          break;

        case 'files-changed':
          store.refreshChanges(e.stream);
          break;

        case 'op-done':
          // 操作完成后刷新全部数据（含状态、快照）
          if (e.stream) store.refreshWorkspace(e.stream);
          break;
      }
    });

    return () => unsub();
  }, []);
}
```

- [ ] **Step 2: 运行 lint**

```bash
cd P4GitTool.Electron && tsc --noEmit src/hooks/useEventStream.ts
```

Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/src/hooks/useEventStream.ts
git commit -m "feat: useEventStream hook 订阅 SSE 统一事件流"
```

---

## Task 3: 组件 TabBar.tsx — 顶部工作区 Tab

**Files:**
- Create: `P4GitTool.Electron/src/components/TabBar.tsx`

- [ ] **Step 1: 实现 TabBar**

Create: `P4GitTool.Electron/src/components/TabBar.tsx`

```typescript
import React from 'react';
import { RefreshCcw, Settings } from 'lucide-react';
import { useAppStore } from '../store/appStore';

interface Props {
  onOpenConfig: () => void;
}

export const TabBar: React.FC<Props> = ({ onOpenConfig }) => {
  const config = useAppStore((s) => s.config);
  const currentStream = useAppStore((s) => s.currentStream);
  const workspaces = useAppStore((s) => s.workspaces);
  const setCurrentStream = useAppStore((s) => s.setCurrentStream);
  const refreshWorkspace = useAppStore((s) => s.refreshWorkspace);

  const streams = config?.streams ?? [];

  return (
    <div className="h-[38px] bg-[#2d2d2d] flex items-center px-3 gap-2 border-b border-[#141414] select-none">
      <span className="text-[#007acc] text-[13px] font-bold">⬡ P4Git</span>
      <div className="w-px h-4 bg-[#444] mx-1" />

      <div className="flex items-stretch h-full">
        {streams.map((s) => {
          const active = s.name === currentStream;
          const count = workspaces[s.name]?.changes.length ?? 0;
          return (
            <button
              key={s.name}
              onClick={() => setCurrentStream(s.name)}
              className={`
                relative px-4 text-[11px] cursor-pointer transition-colors
                ${active
                  ? 'bg-[#1e1e1e] text-white border-t-2 border-[#007acc]'
                  : 'text-[#888] hover:text-[#ccc] hover:bg-[#333]'}
              `}
            >
              {s.name}
              {count > 0 && (
                <span className="absolute top-1 right-1 bg-[#cca700] text-black text-[8px] font-bold rounded-full px-1">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex gap-1">
        <button
          onClick={() => currentStream && refreshWorkspace(currentStream)}
          title="刷新"
          className="w-7 h-7 flex items-center justify-center text-[#888] hover:text-[#ccc] hover:bg-[#3c3c3c] rounded"
        >
          <RefreshCcw size={14} />
        </button>
        <button
          onClick={onOpenConfig}
          title="设置"
          className="w-7 h-7 flex items-center justify-center text-[#888] hover:text-[#ccc] hover:bg-[#3c3c3c] rounded"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: 运行 tsc 确认文件类型正确**

```bash
cd P4GitTool.Electron && tsc --noEmit src/components/TabBar.tsx
```

Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/src/components/TabBar.tsx
git commit -m "feat: TabBar 组件（顶部工作区 Tab）"
```

---

## Task 4: 组件 FileList.tsx — 左侧文件列表

带右键菜单（还原此文件），底部三个操作按钮。

**Files:**
- Create: `P4GitTool.Electron/src/components/FileList.tsx`

- [ ] **Step 1: 实现 FileList**

Create: `P4GitTool.Electron/src/components/FileList.tsx`

```typescript
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
  const isLoading = useAppStore((s) => s.isLoading);

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
        {ws.changes.length === 0 && (
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
```

- [ ] **Step 2: 实现 SnapshotDialog**

Create: `P4GitTool.Electron/src/components/SnapshotDialog.tsx`

```typescript
import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const SnapshotDialog: React.FC<Props> = ({ open, onClose }) => {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const runSnapshot = useAppStore((s) => s.runSnapshot);

  if (!open) return null;

  const submit = async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    const ok = await runSnapshot(message.trim());
    setSubmitting(false);
    if (ok) {
      setMessage('');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-[#252526] border border-[#444] rounded-lg w-[440px] p-5">
        <h3 className="text-[14px] font-bold text-white mb-3">提交快照</h3>
        <p className="text-[11px] text-[#888] mb-3">给这次改动一个描述，作为时间线上的里程碑</p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="例如：武器伤害调整完成"
          rows={3}
          className="w-full bg-[#1e1e1e] border border-[#444] rounded p-2 text-[12px] text-[#ccc] resize-none focus:outline-none focus:border-[#007acc]"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] text-[#ccc] hover:bg-[#333] rounded"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={!message.trim() || submitting}
            className="px-3 py-1.5 bg-[#007acc] hover:bg-[#1c91ea] disabled:opacity-50 text-white text-[11px] font-bold rounded"
          >
            {submitting ? '提交中...' : '提交快照'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: tsc 检查两个文件**

```bash
cd P4GitTool.Electron && tsc --noEmit
```

Expected: 若 App.tsx 仍引用旧 state，会报错，这些将在后续 Task 修复。但新增的两个组件本身无错误。

- [ ] **Step 4: 提交**

```bash
git add P4GitTool.Electron/src/components/FileList.tsx P4GitTool.Electron/src/components/SnapshotDialog.tsx
git commit -m "feat: FileList + SnapshotDialog 组件"
```

---

## Task 5: 组件 DiffPanel.tsx — diff 面板含 hunk/line discard

**Files:**
- Create: `P4GitTool.Electron/src/components/DiffPanel.tsx`

- [ ] **Step 1: 实现 DiffPanel**

Create: `P4GitTool.Electron/src/components/DiffPanel.tsx`

```typescript
import React from 'react';
import { X, RotateCcw } from 'lucide-react';
import { useAppStore, useCurrentWorkspace } from '../store/appStore';
import { DiffHunk } from '../api/client';

export const DiffPanel: React.FC = () => {
  const ws = useCurrentWorkspace();
  const runDiscardHunk = useAppStore((s) => s.runDiscardHunk);
  const runDiscardLine = useAppStore((s) => s.runDiscardLine);

  if (!ws.selectedFile) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#555] text-[12px]">
        选择左侧文件查看改动内容
      </div>
    );
  }

  if (!ws.diff) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#555] text-[12px]">
        加载中...
      </div>
    );
  }

  const renderHunk = (hunk: DiffHunk, hunkIndex: number) => {
    let oldLn = hunk.oldStart;
    let newLn = hunk.newStart;

    return (
      <div key={hunkIndex} className="mb-4">
        <div className="group px-4 py-1 bg-[#569cd614] flex items-center justify-between sticky top-0">
          <span className="text-[#569cd6] text-[10px] font-mono">{hunk.header}</span>
          <button
            onClick={async () => {
              if (!confirm('撤销这段改动？')) return;
              await runDiscardHunk(ws.selectedFile!, hunkIndex);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-[#888] hover:text-[#f48771] px-2 py-0.5 rounded hover:bg-[#3c3c3c]"
          >
            <RotateCcw size={10} /> Discard hunk
          </button>
        </div>

        <div className="font-mono text-[11px] leading-[1.7]">
          {hunk.lines.map((l, lineIndex) => {
            const isAdd = l.type === 'add';
            const isDel = l.type === 'del';
            const isCtx = l.type === 'ctx';
            const bg = isAdd ? 'bg-[#4ec9b014]' : isDel ? 'bg-[#f4877114]' : '';
            const color = isAdd ? 'text-[#4ec9b0]' : isDel ? 'text-[#f48771]' : 'text-[#888]';
            const sign = isAdd ? '+' : isDel ? '-' : ' ';

            let lnOld: number | string = ' ';
            let lnNew: number | string = ' ';
            if (isCtx) { lnOld = oldLn++; lnNew = newLn++; }
            else if (isAdd) { lnNew = newLn++; }
            else if (isDel) { lnOld = oldLn++; }

            return (
              <div
                key={lineIndex}
                className={`group/line px-4 flex gap-3 ${bg} ${color}`}
              >
                <span className="text-[#444] w-6 text-right select-none">
                  {typeof lnOld === 'number' ? lnOld : ''}
                </span>
                <span className="text-[#444] w-6 text-right select-none">
                  {typeof lnNew === 'number' ? lnNew : ''}
                </span>
                <span className="w-3 select-none">{sign}</span>
                <span className="flex-1 whitespace-pre">{l.content}</span>
                {!isCtx && (
                  <button
                    onClick={async () => {
                      if (!confirm('撤销这一行改动？')) return;
                      await runDiscardLine(ws.selectedFile!, hunkIndex, lineIndex);
                    }}
                    className="opacity-0 group-hover/line:opacity-100 transition-opacity text-[9px] text-[#888] hover:text-[#f48771]"
                    title="撤销单行"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-3 py-1.5 bg-[#252526] border-b border-[#333] flex items-center gap-2 text-[11px]">
        <span className="text-[#ccc] font-bold">{ws.selectedFile}</span>
        <span className="ml-auto text-[10px] text-[#555]">
          {ws.diff.hunks.length} hunk{ws.diff.hunks.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex-1 overflow-auto pt-2 pb-4">
        {ws.diff.hunks.length === 0 ? (
          <div className="text-center text-[#555] text-[12px] py-8">无内容差异</div>
        ) : (
          ws.diff.hunks.map((h, i) => renderHunk(h, i))
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: tsc 检查**

```bash
cd P4GitTool.Electron && tsc --noEmit src/components/DiffPanel.tsx
```

Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/src/components/DiffPanel.tsx
git commit -m "feat: DiffPanel 组件（hunk/line discard）"
```

---

## Task 6: 组件 Timeline.tsx + RollbackDialog.tsx

横向时间线 + 回滚确认对话框。

**Files:**
- Create: `P4GitTool.Electron/src/components/RollbackDialog.tsx`
- Create: `P4GitTool.Electron/src/components/Timeline.tsx`

- [ ] **Step 1: 实现 RollbackDialog**

Create: `P4GitTool.Electron/src/components/RollbackDialog.tsx`

```typescript
import React, { useState } from 'react';
import { useAppStore, useCurrentWorkspace } from '../store/appStore';
import { SnapshotEntry } from '../api/client';

interface Props {
  snapshot: SnapshotEntry | null;
  onClose: () => void;
}

export const RollbackDialog: React.FC<Props> = ({ snapshot, onClose }) => {
  const ws = useCurrentWorkspace();
  const runRollback = useAppStore((s) => s.runRollback);
  const [submitting, setSubmitting] = useState(false);

  if (!snapshot) return null;

  const hasChanges = ws.changes.length > 0;

  const submit = async () => {
    setSubmitting(true);
    const ok = await runRollback(snapshot.hash);
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-[#252526] border border-[#444] rounded-lg w-[460px] p-5">
        <h3 className="text-[14px] font-bold text-white mb-3">回滚到此节点</h3>

        <div className="bg-[#1e1e1e] rounded p-3 mb-3 border border-[#333]">
          <div className="text-[10px] text-[#888] mb-1">
            {new Date(snapshot.date).toLocaleString('zh-CN')}
          </div>
          <div className="text-[12px] text-[#ccc] break-all">{snapshot.message}</div>
          <div className="text-[10px] text-[#569cd6] mt-1">
            {snapshot.fileCount} 个文件 · {snapshot.hash.slice(0, 7)}
          </div>
        </div>

        {hasChanges ? (
          <div className="bg-[#f4877122] border border-[#f4877144] rounded p-3 text-[11px] text-[#f48771]">
            当前有 {ws.changes.length} 个未提交的改动。请先提交快照或还原所有改动，再执行回滚。
          </div>
        ) : (
          <p className="text-[11px] text-[#888]">
            回滚会把工作区文件恢复到此状态，并产生一个新的回滚快照记录。原有历史不会丢失。
          </p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-[11px] text-[#ccc] hover:bg-[#333] rounded">
            取消
          </button>
          <button
            onClick={submit}
            disabled={hasChanges || submitting}
            className="px-3 py-1.5 bg-[#cca700] hover:bg-[#e0b800] disabled:opacity-40 disabled:cursor-not-allowed text-black text-[11px] font-bold rounded"
          >
            {submitting ? '回滚中...' : '确认回滚'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: 实现 Timeline**

Create: `P4GitTool.Electron/src/components/Timeline.tsx`

```typescript
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useAppStore, useCurrentWorkspace } from '../store/appStore';
import { SnapshotEntry } from '../api/client';
import { RollbackDialog } from './RollbackDialog';

const COLORS: Record<SnapshotEntry['kind'], { border: string; bg: string; glow?: string; label: string; tagBg: string; tagText: string }> = {
  sync:           { border: '#007acc', bg: '#007acc33',                                label: 'P4 Sync',   tagBg: '#007acc22', tagText: '#007acc' },
  'sync-protect': { border: '#569cd6', bg: '#569cd622', glow: 'rgba(86,156,214,0.3)',  label: '自动保护',  tagBg: '#569cd622', tagText: '#569cd6' },
  manual:         { border: '#cca700', bg: '#cca70022', glow: 'rgba(204,167,0,0.35)',  label: '手动',      tagBg: '#cca70022', tagText: '#cca700' },
  submit:         { border: '#4ec9b0', bg: '#4ec9b022',                                label: 'P4 提交',   tagBg: '#4ec9b022', tagText: '#4ec9b0' },
  other:          { border: '#484848', bg: '#282828',                                  label: '其他',      tagBg: '#33333355', tagText: '#888'    },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function shortMsg(msg: string): string {
  const stripped = msg
    .replace(/^update: /, '')
    .replace(/^sync 前自动保护.*/, 'sync 前保护')
    .replace(/^submit: /, '')
    .replace(/^revert: /, 'revert ');
  return stripped.length > 18 ? stripped.slice(0, 17) + '…' : stripped;
}

export const Timeline: React.FC = () => {
  const ws = useCurrentWorkspace();
  const collapsed = useAppStore((s) => s.timelineCollapsed);
  const toggle = useAppStore((s) => s.toggleTimeline);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rollbackTarget, setRollbackTarget] = useState<SnapshotEntry | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [ws.snapshots.length]);

  return (
    <>
      <div
        onClick={toggle}
        className="h-8 bg-[#252526] border-b border-[#333] flex items-center px-3 gap-2 cursor-pointer select-none hover:bg-[#2a2d2e]"
      >
        <span className="text-[10px] font-bold text-[#707070] tracking-wider uppercase">
          ⏱ 快照时间线
        </span>
        {!collapsed && <span className="text-[10px] text-[#555]">· 点击节点可回滚</span>}
        <span className="ml-auto text-[#555]">
          {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
      </div>

      {!collapsed && (
        <div
          ref={scrollRef}
          className="h-[110px] bg-[#1e1e1e] overflow-x-auto overflow-y-hidden border-b border-[#333]"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#444 #1e1e1e' }}
        >
          <div className="flex items-start h-full px-6" style={{ minWidth: 'max-content' }}>
            {ws.snapshots.map((s, i) => {
              const c = COLORS[s.kind];
              const isFirst = i === 0;
              return (
                <button
                  key={s.hash}
                  onClick={() => setRollbackTarget(s)}
                  className="flex flex-col items-center flex-shrink-0 w-[88px] pt-[26px] relative group"
                >
                  <div className="flex items-center w-full">
                    <div className={`flex-1 h-[2px] ${isFirst ? 'bg-transparent' : 'bg-[#3a3a3a]'}`} />
                    <div
                      className="w-3 h-3 rounded-full border-2 transition-transform group-hover:scale-[1.35]"
                      style={{
                        borderColor: c.border,
                        background: c.bg,
                        boxShadow: c.glow ? `0 0 6px ${c.glow}` : undefined,
                      }}
                    />
                    <div className="flex-1 h-[2px] bg-[#3a3a3a]" />
                  </div>
                  <div className="mt-2 text-center w-[84px]">
                    <div className="text-[9px] text-[#555] mb-0.5">{formatTime(s.date)}</div>
                    <div className="text-[10px] text-[#999] truncate">{shortMsg(s.message)}</div>
                    <div
                      className="inline-block text-[8px] mt-1 rounded px-1.5 py-0.5"
                      style={{ background: c.tagBg, color: c.tagText }}
                    >
                      {c.label}
                    </div>
                  </div>
                </button>
              );
            })}

            {/* 当前工作区节点（紫色） */}
            <div className="flex flex-col items-center flex-shrink-0 w-[88px] pt-[26px]">
              <div className="flex items-center w-full">
                <div className="flex-1 h-[2px] bg-[#3a3a3a]" />
                <div
                  className="w-3.5 h-3.5 rounded-full border-2"
                  style={{
                    borderColor: '#c586c0',
                    background: '#c586c022',
                    boxShadow: '0 0 8px rgba(197,134,192,0.35)',
                  }}
                />
                <div className="flex-1 h-[2px] bg-transparent" />
              </div>
              <div className="mt-2 text-center w-[84px]">
                <div className="text-[9px] text-[#555] mb-0.5">现在</div>
                <div className="text-[10px] text-[#999] truncate">
                  {ws.changes.length > 0 ? `${ws.changes.length} 个未提交` : '无改动'}
                </div>
                <div
                  className="inline-block text-[8px] mt-1 rounded px-1.5 py-0.5 border border-[#c586c044]"
                  style={{ background: '#c586c022', color: '#c586c0' }}
                >
                  工作区
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <RollbackDialog snapshot={rollbackTarget} onClose={() => setRollbackTarget(null)} />
    </>
  );
};
```

- [ ] **Step 3: tsc 检查**

```bash
cd P4GitTool.Electron && tsc --noEmit src/components/Timeline.tsx src/components/RollbackDialog.tsx
```

Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add P4GitTool.Electron/src/components/Timeline.tsx P4GitTool.Electron/src/components/RollbackDialog.tsx
git commit -m "feat: Timeline + RollbackDialog 组件"
```

---

## Task 7: 组件 LogPanel.tsx + StatusBar.tsx

**Files:**
- Modify/Replace: `P4GitTool.Electron/src/components/LogPanel.tsx`
- Create: `P4GitTool.Electron/src/components/StatusBar.tsx`

- [ ] **Step 1: 重写 LogPanel.tsx**

Replace `P4GitTool.Electron/src/components/LogPanel.tsx` with:

```typescript
import React, { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';

function logLineClass(line: string): string {
  if (/\[ERROR\]/i.test(line)) return 'text-[#f48771]';
  if (/\[WARN\]/i.test(line)) return 'text-[#cca700]';
  if (/\[OK\]/i.test(line)) return 'text-[#4ec9b0]';
  if (/\[INFO\]/i.test(line)) return 'text-[#9cdcfe]';
  return 'text-[#888]';
}

export const LogPanel: React.FC = () => {
  const collapsed = useAppStore((s) => s.logCollapsed);
  const toggle = useAppStore((s) => s.toggleLog);
  const logs = useAppStore((s) => s.logs);
  const clearLogs = useAppStore((s) => s.clearLogs);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed) endRef.current?.scrollIntoView({ block: 'end' });
  }, [logs.length, collapsed]);

  return (
    <>
      <div
        onClick={toggle}
        className="h-7 bg-[#252526] border-b border-[#333] flex items-center px-3 gap-2 cursor-pointer select-none hover:bg-[#2a2d2e]"
      >
        <span className="text-[10px] font-bold text-[#707070] tracking-wider uppercase">
          📋 操作日志
        </span>
        <span className="text-[10px] text-[#555]">· {logs.length} 条</span>
        <div className="ml-auto flex items-center gap-2">
          {!collapsed && (
            <button
              onClick={(e) => { e.stopPropagation(); clearLogs(); }}
              className="text-[#666] hover:text-[#ccc]"
              title="清空"
            >
              <Trash2 size={11} />
            </button>
          )}
          <span className="text-[#555]">
            {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div className="h-[120px] bg-[#1a1a1a] px-3 py-1.5 font-mono text-[10px] leading-[1.6] overflow-y-auto">
          {logs.map((l, i) => (
            <div key={i} className={logLineClass(l)}>{l}</div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </>
  );
};
```

- [ ] **Step 2: 实现 StatusBar**

Create: `P4GitTool.Electron/src/components/StatusBar.tsx`

```typescript
import React, { useMemo } from 'react';
import { useAppStore, useCurrentWorkspace } from '../store/appStore';

export const StatusBar: React.FC = () => {
  const currentStream = useAppStore((s) => s.currentStream);
  const isLoading = useAppStore((s) => s.isLoading);
  const loadingOp = useAppStore((s) => s.loadingOp);
  const ws = useCurrentWorkspace();

  const lastSnapshot = useMemo(() => {
    if (!ws.snapshots.length) return null;
    return ws.snapshots[ws.snapshots.length - 1];
  }, [ws.snapshots]);

  const lastSnapshotLabel = lastSnapshot
    ? new Date(lastSnapshot.date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '无';

  return (
    <div className="h-6 bg-[#007acc] flex items-center px-3 gap-4 text-[11px] text-white/90 flex-shrink-0">
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-[#4ec9b0]" />
        {currentStream || '未选择工作区'}
      </div>

      <div className="flex items-center gap-1.5">
        最近快照 · {lastSnapshotLabel}
      </div>

      {isLoading && (
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#cca700] animate-pulse" />
          {loadingOp ?? '处理中'}...
        </div>
      )}

      <div className="ml-auto flex items-center gap-4">
        <span>{ws.changes.length} 个改动</span>
        <span className="opacity-60">P4Git Tool</span>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: tsc 检查**

```bash
cd P4GitTool.Electron && tsc --noEmit src/components/LogPanel.tsx src/components/StatusBar.tsx
```

Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add P4GitTool.Electron/src/components/LogPanel.tsx P4GitTool.Electron/src/components/StatusBar.tsx
git commit -m "feat: LogPanel 重写 + StatusBar 新增"
```

---

## Task 8: 精简 App.tsx 为布局容器

把 App.tsx 从 560 行压缩到约 50 行，所有业务代码已分散到独立组件。

**Files:**
- Modify: `P4GitTool.Electron/src/App.tsx`
- Delete: `P4GitTool.Electron/src/components/StashPanel.tsx`
- Delete: `P4GitTool.Electron/src/components/ChangesPanel.tsx`

- [ ] **Step 1: 完整替换 App.tsx**

Replace `P4GitTool.Electron/src/App.tsx` with:

```typescript
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
```

- [ ] **Step 2: 删除旧组件**

```bash
cd P4GitTool.Electron && rm -f src/components/StashPanel.tsx src/components/ChangesPanel.tsx
```

- [ ] **Step 3: 检查并调整 ConfigDialog**

Read: `src/components/ConfigDialog.tsx`

确认：
- Props 签名为 `{ open: boolean; onClose: () => void }`（如果不是，调整为这个签名）
- 开始处有 `if (!open) return null;`
- 保存时调用 `useAppStore.getState().saveConfig(cfg)` 而不是直接调 `api.saveConfig`（让 store 同步 state）

若现有 ConfigDialog 签名不一致，修改为：

```typescript
interface Props {
  open: boolean;
  onClose: () => void;
}

export const ConfigDialog: React.FC<Props> = ({ open, onClose }) => {
  if (!open) return null;
  // ...原实现
  // 保存按钮改为调 useAppStore.getState().saveConfig(cfg)
};
```

- [ ] **Step 4: 全量 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

Expected: 无错误。若仍有错误，检查遗留的旧引用（如 `appStore` 中已删除的 state 访问）。

- [ ] **Step 5: 运行 dev 模式手动验证**

```bash
cd P4GitTool.Electron && npm run dev
```

验证：窗口能启动、Tab 能切换、文件列表/日志/时间线/状态栏都能显示。按 Ctrl+C 停止。

- [ ] **Step 6: 提交**

```bash
git add P4GitTool.Electron/src/App.tsx P4GitTool.Electron/src/components/ConfigDialog.tsx
git rm P4GitTool.Electron/src/components/StashPanel.tsx P4GitTool.Electron/src/components/ChangesPanel.tsx
git commit -m "refactor: App.tsx 精简为布局容器，删除 StashPanel/ChangesPanel"
```

---

## Task 9: 清理 Plan 1 遗留的 stash stub

前端已经不再引用 stash 相关函数，彻底删除 Plan 1 保留的 stub。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/operations.ts`

- [ ] **Step 1: 搜索残留引用**

```bash
cd P4GitTool.Electron && grep -rn "listStashes\|createStash\|popStash\|dropStash\|StashEntry" electron/ src/ --include="*.ts" --include="*.tsx"
```

Expected: 只在 `operations.ts` 自身的定义处有匹配。

- [ ] **Step 2: 删除 stub 定义**

在 `operations.ts` 中删除 Plan 1 Task 8 添加的几行：

```typescript
export interface StashEntry { ... }
export async function listStashes(): Promise<StashEntry[]> { return []; }
export async function createStash(): Promise<boolean> { return false; }
export async function popStash(): Promise<boolean> { return false; }
export async function dropStash(): Promise<boolean> { return false; }
```

- [ ] **Step 3: 删除 mergeForward stub**

同样删除 Plan 1 Task 8 保留的临时 stub：

```typescript
async function mergeForward(...) { return true; }
```

- [ ] **Step 4: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/services/operations.ts
git commit -m "refactor: 删除 Plan 1 遗留的 stash/mergeForward stub"
```

---

## Task 10: 补充 submit 两阶段的 UI 浮层

规格要求：提交到 P4 分两步，`submitPrepare` 打开 P4V，用户在 P4V 完成提交后回到工具点 `submitConfirm`。当前 UI 缺少这个"确认完成"的按钮。

**Files:**
- Modify: `P4GitTool.Electron/src/store/appStore.ts`
- Modify: `P4GitTool.Electron/src/App.tsx`

- [ ] **Step 1: 在 store 增加 submitPending 状态**

在 `appStore.ts` 的 AppState 接口新增：

```typescript
submitPending: boolean;
submitChangelist: number | null;
setSubmitPending: (v: boolean, cl?: number) => void;
```

在 `create<AppState>` 的初始值：

```typescript
submitPending: false,
submitChangelist: null,
setSubmitPending: (v, cl) => set({ submitPending: v, submitChangelist: cl ?? null }),
```

修改 `useEventStream` hook 的 `op-done` 处理：

Modify `src/hooks/useEventStream.ts`：

```typescript
case 'op-done':
  if (e.op === 'submit-prepare' && e.ok) {
    const cl = e.detail ? parseInt(e.detail, 10) : undefined;
    store.setSubmitPending(true, cl);
  }
  if (e.op === 'submit-confirm' && e.ok) {
    store.setSubmitPending(false);
  }
  if (e.stream) store.refreshWorkspace(e.stream);
  break;
```

- [ ] **Step 2: 在 App.tsx 插入浮条**

Modify `src/App.tsx`，在 `<TabBar />` 下方插入：

```tsx
import { useAppStore } from './store/appStore';

// 在组件内
const submitPending = useAppStore((s) => s.submitPending);
const submitChangelist = useAppStore((s) => s.submitChangelist);
const runSubmitConfirm = useAppStore((s) => s.runSubmitConfirm);
const setSubmitPending = useAppStore((s) => s.setSubmitPending);

// 在 TabBar 后面
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
```

- [ ] **Step 3: 运行 lint + dev 模式手动测试**

```bash
cd P4GitTool.Electron && npm run lint
cd P4GitTool.Electron && npm run dev
```

验证 submit 流程：点击"提交到 P4"后浮条出现，点击"确认提交完成"后浮条消失。

- [ ] **Step 4: 提交**

```bash
git add P4GitTool.Electron/src/store/appStore.ts P4GitTool.Electron/src/hooks/useEventStream.ts P4GitTool.Electron/src/App.tsx
git commit -m "feat: submit 两阶段 pending 浮条"
```

---

## Task 11: 端到端手动验证

**Files:** （无代码改动，手动测试）

- [ ] **Step 1: 启动 dev 模式**

```bash
cd P4GitTool.Electron && npm run dev
```

- [ ] **Step 2: 首次配置**

- 应用启动自动弹出 ConfigDialog
- 填写 `p4_port`、`p4_user`，添加一个测试 stream
- 保存

- [ ] **Step 3: 文件变化自动刷新**

- 在 P4 工作区目录里改一个文件
- 等约 500ms，文件列表应自动出现该文件
- 点击文件 → DiffPanel 显示改动

- [ ] **Step 4: Hunk 和单行 Discard**

- 悬停某个 hunk，出现 "Discard hunk" 按钮
- 点击确认 → hunk 消失，文件已还原
- 悬停某增/删行，出现行尾的 "✕" 按钮
- 点击 → 只有该行被还原

- [ ] **Step 5: 提交快照**

- 点击"提交快照" → 填写描述 → 确认
- 时间线出现黄色节点
- 文件列表清空

- [ ] **Step 6: 回滚**

- 点击时间线上某个历史节点
- 打开回滚确认对话框
- 若当前有改动，按钮禁用并显示红色提示
- 提交一个快照清空改动后再回滚
- 文件恢复，时间线追加 revert 节点

- [ ] **Step 7: P4 Sync + Sync 前保护**

- 先改几个文件但不提交快照
- 点击 "P4 Sync"
- 观察时间线应先产生 "Sync 前保护"（浅蓝）节点，再产生 "P4 Sync"（深蓝）节点

- [ ] **Step 8: 多工作区切换**

- 在配置里新增第二个 stream
- 保存后顶部出现新 Tab
- 切换 Tab，两个工作区的数据互相独立

- [ ] **Step 9: 提交到 P4（两阶段）**

- 点击"提交到 P4"
- 自动执行 checkAndUpdate、reconcile、创建 Changelist、打开 P4V
- 顶部黄色浮条出现
- 在 P4V 完成提交
- 回到工具点击"确认提交完成"
- 浮条消失，时间线出现绿色 "P4 提交" 节点

- [ ] **Step 10: 记录发现的问题**

把手动测试中发现的问题整理成一份清单。若有问题，优先修复后再进 Task 12。

---

## Task 12: 打包验证

- [ ] **Step 1: 清理构建产物**

```bash
cd P4GitTool.Electron && rm -rf dist dist-electron release
```

- [ ] **Step 2: 打包 dir 版本（不制作安装包）**

```bash
cd P4GitTool.Electron && npm run package:dir
```

Expected: `release/win-unpacked/` 目录下有完整 exe。

- [ ] **Step 3: 运行打包版本**

双击 `release/win-unpacked/P4Git Tool.exe`，验证：
- 无白屏
- 能读取配置
- 能监听文件变化
- 所有核心流程可用

- [ ] **Step 4: 若无问题，制作正式安装包**

```bash
cd P4GitTool.Electron && npm run package
```

产物在 `release/P4Git Tool Setup x.x.x.exe`。

- [ ] **Step 5: 提交打包配置的修改（若有）**

```bash
git add -A
git commit -m "chore: 打包验证通过"
```

---

## 自检清单（规格覆盖）

| 规格要求 | 对应 Task |
|---|---|
| 顶部工作区 Tab + 改动数角标 | Task 3（TabBar） |
| 切换 Tab 切换工作区 | Task 3 + Task 1（store 的 setCurrentStream） |
| 文件列表相对 mirror/p4 的真实改动 | Plan 1 的 getChangedFiles + Task 4（FileList 显示） |
| 文件右键"还原此文件" | Task 4（FileList 右键菜单） |
| 三个操作按钮（快照/提交 P4/P4 Sync） | Task 4 |
| Diff 面板行号 + 增删高亮 | Task 5（DiffPanel） |
| Hunk Discard | Task 5 |
| 单行 Discard | Task 5 |
| 时间线节点穿在线上 + 横向滚动 | Task 6（Timeline） |
| 五种节点颜色（含紫色当前工作区） | Task 6（COLORS 定义 + 紫色节点） |
| 点击节点触发回滚确认 | Task 6（RollbackDialog） |
| 未提交改动时回滚禁用 | Task 6（RollbackDialog 检查 ws.changes） |
| 操作日志可折叠 + 错误自动展开 | Task 7（LogPanel）+ Task 1 appendLog 逻辑 |
| 底部状态栏 | Task 7（StatusBar） |
| 提交快照对话框 | Task 4（SnapshotDialog） |
| SSE 订阅自动刷新 | Task 2（useEventStream） |
| 首次启动自动打开配置 | Task 8（App.tsx useEffect） |
| 删除 stash UI | Task 8（删除 StashPanel） |
| 删除 stash 后端 stub | Task 9 |
| 提交 P4 两阶段（prepare + confirm） | Task 10 |
| 打包 | Task 12 |

---

## 执行建议

本计划 13 个 Task（Task 0-12）。建议按 subagent-driven-development 执行，每个 Task 交给独立 subagent，完成后人工验证 UI 效果再进下一个。关键检查点：

- Task 2（useEventStream）完成后：DevTools Network 面板应看到 `/api/events` 连接保持
- Task 5（DiffPanel）完成后：手动测一次 hunk discard，看文件是否正确修改
- Task 6（Timeline）完成后：节点颜色、横向滚动、回滚对话框是否符合设计
- Task 11（端到端手动验证）是整体集成测试
- Task 12（打包）在所有功能 OK 后执行

如遇 SSE 断线、打包后路径错误等问题，优先检查 `vite.config.ts` 的 external 配置和 preload 路径。





