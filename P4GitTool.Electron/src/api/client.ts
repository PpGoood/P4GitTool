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
  workspaces_dir: string;
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
