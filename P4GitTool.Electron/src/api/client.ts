// 获取 API 端口（通过 IPC 异步获取，缓存结果）
let cachedPort: number | null = null;

function rlog(msg: string) {
  if (typeof window !== 'undefined' && (window as any).electron?.log) {
    (window as any).electron.log(msg);
  }
}

async function getBaseUrl(): Promise<string> {
  if (cachedPort) return `http://127.0.0.1:${cachedPort}`;

  rlog('getBaseUrl: 开始获取端口');
  rlog(`getBaseUrl: window.electron = ${JSON.stringify(Object.keys((window as any).electron ?? {}))}`);

  if (typeof window !== 'undefined' && (window as any).electron?.getApiPort) {
    try {
      cachedPort = await (window as any).electron.getApiPort();
      rlog(`getBaseUrl: IPC 返回端口 ${cachedPort}`);
    } catch (e: any) {
      rlog(`getBaseUrl: IPC 失败 ${e.message}，使用 3001`);
      cachedPort = 3001;
    }
    return `http://127.0.0.1:${cachedPort}`;
  }

  rlog('getBaseUrl: electron.getApiPort 不存在，使用 3001');
  return 'http://127.0.0.1:3001';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const baseUrl = await getBaseUrl();
  const url = `${baseUrl}/api${path}`;
  rlog(`REQ ${method} ${url} body=${body ? JSON.stringify(body).slice(0, 100) : 'none'}`);
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
    let es: EventSource | null = null;
    let closed = false;

    getBaseUrl().then(baseUrl => {
      if (closed) return;
      rlog(`SSE 连接: ${baseUrl}/api/events`);
      es = new EventSource(`${baseUrl}/api/events`);
      es.onopen = () => rlog('SSE 连接成功');
      es.onerror = (e) => rlog(`SSE 连接错误: ${JSON.stringify(e)}`);
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          onEvent(data);
        } catch {
          // 忽略非 JSON 行
        }
      };
    });

    return () => {
      closed = true;
      es?.close();
    };
  },
};
