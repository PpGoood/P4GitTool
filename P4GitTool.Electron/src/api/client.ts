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
const del = <T>(path: string) => request<T>('DELETE', path);

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

export interface Snapshot {
  hash: string;
  message: string;
  date: string;
}

export interface StashEntry {
  index: number;
  name: string;
  branch: string;
  stream: string;
  date: string;
}

export interface P4GitConfig {
  p4_port: string;
  p4_user: string;
  streams: { name: string; client: string; root: string }[];
}

// -------------------------------------------------------
// API
// -------------------------------------------------------

export const api = {
  // 配置
  getConfig: () => get<P4GitConfig>('/config'),
  saveConfig: (cfg: P4GitConfig) => post<{ ok: boolean }>('/config', cfg),

  // 状态
  getStatus: (stream: string) => get<StreamStatus>(`/status?stream=${encodeURIComponent(stream)}`),

  // 分支
  getBranches: (stream: string) => get<{ branches: string[]; current: string }>(`/branches?stream=${encodeURIComponent(stream)}`),

  // 改动文件
  getChanges: (stream: string) => get<{ files: FileChange[] }>(`/changes?stream=${encodeURIComponent(stream)}`),

  // 快照
  createSnapshot: (stream: string, message: string) => post<{ ok: boolean }>('/snapshot', { stream, message }),
  getSnapshots: (stream: string) => get<{ snapshots: Snapshot[] }>(`/snapshots?stream=${encodeURIComponent(stream)}`),

  // Stash
  getStashes: (stream: string, branch: string) =>
    get<{ stashes: StashEntry[] }>(`/stashes?stream=${encodeURIComponent(stream)}&branch=${encodeURIComponent(branch)}`),
  createStash: (stream: string, name: string) => post<{ ok: boolean }>('/stash', { stream, name }),
  popStash: (stream: string, index: number) => post<{ ok: boolean }>('/stash/pop', { stream, index }),
  dropStash: (stream: string, index: number) => del<{ ok: boolean }>(`/stash/${index}?stream=${encodeURIComponent(stream)}`),

  // 操作
  init: () => post<{ ok: boolean }>('/init'),
  pull: (stream: string, scope = 'all', mode = 'standard') => post<{ ok: boolean }>('/pull', { stream, scope, mode }),
  checkAndUpdate: (stream: string) => post<{ ok: boolean }>('/check-update', { stream }),
  submitPrepare: (stream: string) => post<{ ok: boolean }>('/submit-prepare', { stream }),
  submitConfirm: () => post<{ ok: boolean }>('/submit-confirm'),

  // SSE 日志流
  subscribeLog: (onLine: (line: string) => void): () => void => {
    const es = new EventSource(`${getBaseUrl()}/api/log/stream`);
    es.onmessage = (e) => onLine(e.data);
    return () => es.close();
  },
};
