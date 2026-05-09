// API 端口固定为 3001（server.ts 优先使用 3001，被占用时随机）
// 不再依赖 IPC，避免 preload 通信问题
const API_PORT = 3001;

function rlog(msg: string) {
  if (typeof window !== 'undefined' && (window as any).electron?.log) {
    (window as any).electron.log(msg);
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
  snapshot: (stream: string, message: string) =>
    post<{ ok: boolean }>('/snapshot', { stream, message }),
  checkUpdate: (stream: string) =>
    post<{ status: 'ready' | 'outdated' | 'error' }>('/check-update', { stream }),
  submitPrepare: (stream: string) => post<{ ok: boolean }>('/submit-prepare', { stream }),
  submitConfirm: (stream: string) => post<{ ok: boolean }>('/submit-confirm', { stream }),

  discardFile: (stream: string, path: string) =>
    post<{ ok: boolean }>('/discard-file', { stream, path }),
  discardHunk: (stream: string, path: string, hunkIndex: number) =>
    post<{ ok: boolean }>('/discard-hunk', { stream, path, hunkIndex }),
  discardLine: (stream: string, path: string, hunkIndex: number, lineIndex: number) =>
    post<{ ok: boolean }>('/discard-line', { stream, path, hunkIndex, lineIndex }),

  rollback: (stream: string, hash: string) =>
    post<{ ok: boolean }>('/checkout-node', { stream, hash }),

  returnLatest: (stream: string) =>
    post<{ ok: boolean }>('/return-latest', { stream }),

  subscribeEvents: (onEvent: (e: AppEvent) => void): (() => void) => {
    const url = `${getBaseUrl()}/api/events`;
    rlog(`SSE 连接: ${url}`);
    const es = new EventSource(url);
    es.onopen = () => rlog('SSE 连接成功');
    es.onerror = (e) => rlog(`SSE 错误: ${JSON.stringify(e)}`);
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        onEvent(data);
      } catch {}
    };
    return () => es.close();
  },
};
