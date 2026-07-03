// API 端口固定为 3001（server.ts 优先使用 3001，被占用时随机）
// 不再依赖 IPC，避免 preload 通信问题
const API_PORT = 3001;

// Electron preload 注入的 API 类型声明
declare global {
  interface Window {
    electron?: {
      getApiPort: () => Promise<number>;
      log: (msg: string) => void;
    };
  }
}

function rlog(msg: string) {
  if (typeof window !== 'undefined' && window.electron?.log) {
    window.electron.log(msg);
  }
}

function getBaseUrl(): string {
  return `http://127.0.0.1:${API_PORT}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${getBaseUrl()}/api${path}`;
  rlog(`REQ ${method} ${url}`);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      rlog(`RES ${method} ${url} -> ${res.status} ERROR: ${err.error}`);
      throw new Error(err.error ?? res.statusText);
    }
    rlog(`RES ${method} ${url} -> 200 OK`);
    return res.json();
  } catch (e: any) {
    rlog(`RES ${method} ${url} -> FETCH ERROR: ${e.message}`);
    throw e;
  }
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
  headHash: string;
  isDetached: boolean;
  inMergeConflict: boolean;
  mergeConflictFiles: string[];
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
  workspaces_dir: string;
  streams: { name: string; client: string; root: string }[];
}

export type TemplateKind = 'gitignore' | 'gitattributes' | 'claudemd' | 'mcp';
export type SyncState = 'ok' | 'behind' | 'modified' | 'missing';

export interface SkillEntry {
  name: string;
  content: string;
}

export interface StreamSyncStatus {
  stream: string;
  state: SyncState;
}

export interface TemplatesData {
  templates: Record<TemplateKind, string>;
  skills: SkillEntry[];
  status: StreamSyncStatus[];
  templatesDir: string;
}

export interface SyncFileResult {
  target: string;
  action: 'written' | 'unchanged' | 'skipped';
}

export interface SyncStreamResult {
  stream: string;
  ok: boolean;
  files: SyncFileResult[];
  error?: string;
}

export type SubmitPrepareReason =
  | 'stream-not-found'
  | 'dirty-workspace'
  | 'outdated'
  | 'error'
  | 'no-changes'
  | 'create-cl-failed'
  | 'reconcile-failed'
  | 'no-opened-files'
  | 'p4v-launch-failed';

export interface SubmitPrepareResult {
  ok: boolean;
  changelist?: number;
  reason?: SubmitPrepareReason;
}

export type AppEvent =
  | { type: 'log'; line: string }
  | { type: 'files-changed'; stream: string }
  | { type: 'op-done'; op: string; stream: string; ok: boolean; detail?: string };

// -------------------------------------------------------
// API
// -------------------------------------------------------

export const api = {
  getConfig: () => get<P4GitConfig>('/config'),
  saveConfig: (cfg: P4GitConfig) => post<{ ok: boolean }>('/config', cfg),

  getStatus: (stream: string) =>
    get<StreamStatus>(`/status?stream=${encodeURIComponent(stream)}`),

  getChanges: (stream: string) =>
    get<{ files: FileChange[] }>(`/changes?stream=${encodeURIComponent(stream)}`),

  getDiff: (stream: string, filepath: string) =>
    get<{ diff: DiffFile | null }>(
      `/diff?stream=${encodeURIComponent(stream)}&path=${encodeURIComponent(filepath)}`
    ),

  getSnapshots: (stream: string, limit = 100) =>
    get<{ snapshots: SnapshotEntry[] }>(
      `/snapshots?stream=${encodeURIComponent(stream)}&limit=${limit}`
    ),

  init: () => post<{ ok: boolean }>('/init'),
  pull: (stream: string, scope = 'all', mode = 'standard') =>
    post<{ ok: boolean }>('/pull', { stream, scope, mode }),
  alignGit: (stream: string) =>
    post<{ ok: boolean; conflicts?: string[] }>('/align-git', { stream }),
  alignGitContinue: (stream: string, resolution: 'ours' | 'theirs' | 'manual') =>
    post<{ ok: boolean; resolvedFiles?: string[] }>('/align-git-continue', { stream, resolution }),
  snapshot: (stream: string, message: string, files?: string[]) =>
    post<{ ok: boolean }>('/snapshot', { stream, message, files }),
  submitPrepare: (stream: string) =>
    post<SubmitPrepareResult>('/submit-prepare', { stream }),
  openInVscode: (stream: string, filepath: string) =>
    post<{ ok: boolean }>('/open-in-vscode', { stream, filepath }),
  openInExplorer: (stream: string, filepath: string) =>
    post<{ ok: boolean }>('/open-in-explorer', { stream, filepath }),
  openProjectInVscode: (stream: string) =>
    post<{ ok: boolean }>('/open-project-in-vscode', { stream }),
  openClaude: (stream: string) =>
    post<{ ok: boolean }>('/open-claude', { stream }),

  discardFile: (stream: string, path: string) =>
    post<{ ok: boolean }>('/discard-file', { stream, path }),
  discardHunk: (stream: string, path: string, hunkIndex: number) =>
    post<{ ok: boolean }>('/discard-hunk', { stream, path, hunkIndex }),
  discardLine: (stream: string, path: string, hunkIndex: number, lineIndex: number) =>
    post<{ ok: boolean }>('/discard-line', { stream, path, hunkIndex, lineIndex }),

  // 历史节点查看（纯读，不改变工作区）
  getNodeFiles: (stream: string, hash: string, parentHash: string) =>
    get<{ files: FileChange[] }>(
      `/node-files?stream=${encodeURIComponent(stream)}&hash=${encodeURIComponent(hash)}&parentHash=${encodeURIComponent(parentHash)}`
    ),
  getNodeDiff: (stream: string, hash: string, parentHash: string, filepath: string) =>
    get<{ diff: DiffFile | null }>(
      `/node-diff?stream=${encodeURIComponent(stream)}&hash=${encodeURIComponent(hash)}&parentHash=${encodeURIComponent(parentHash)}&path=${encodeURIComponent(filepath)}`
    ),

  // Checkout 到历史节点（detached HEAD，用于验证问题）
  checkoutNode: (stream: string, hash: string) =>
    post<{ ok: boolean }>('/checkout-node', { stream, hash }),
  returnLatest: (stream: string, force = false) =>
    post<{ ok: boolean; hasChanges?: boolean; changes?: FileChange[] }>('/return-latest', { stream, force }),

  // 配置模板管理
  getTemplates: () => get<TemplatesData>('/templates'),
  saveTemplate: (kind: TemplateKind, content: string) =>
    post<{ ok: boolean }>('/templates', { kind, content }),
  saveSkill: (name: string, content: string) =>
    post<{ ok: boolean }>('/skills', { name, content }),
  deleteSkill: (name: string) =>
    post<{ ok: boolean }>('/skills/delete', { name }),
  syncConfig: (stream?: string) =>
    post<{ ok: boolean; results: SyncStreamResult[] }>('/sync-config', stream ? { stream } : {}),
  openTemplatesDir: () =>
    post<{ ok: boolean }>('/open-templates-dir', {}),

  subscribeEvents: (
    onEvent: (e: AppEvent) => void,
    onError?: (reason: string) => void,
  ): (() => void) => {
    const url = `${getBaseUrl()}/api/events`;
    rlog(`SSE 连接: ${url}`);
    const es = new EventSource(url);
    // EventSource 会自动重连。readyState 进入 CLOSED 前都视作瞬时断开。
    let lastNotifiedClosed = false;
    es.onopen = () => {
      rlog('SSE 连接成功');
      lastNotifiedClosed = false;
    };
    es.onerror = () => {
      // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
      const state = es.readyState;
      rlog(`SSE 错误，readyState=${state}`);
      if (state === EventSource.CLOSED && !lastNotifiedClosed) {
        lastNotifiedClosed = true;
        onError?.('事件流连接已断开，刷新窗口或重启工具可恢复');
      } else if (state === EventSource.CONNECTING && !lastNotifiedClosed) {
        lastNotifiedClosed = true;
        onError?.('后端事件流暂时不可用，正在自动重连...');
      }
    };
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        onEvent(data);
      } catch {}
    };
    return () => es.close();
  },
};
