import { run } from './runner';
import { P4GitConfig, getStream } from './config';

function p4Args(cfg: P4GitConfig) {
  return ['-p', cfg.p4_port, '-u', cfg.p4_user];
}

export async function p4Login(cfg: P4GitConfig): Promise<boolean> {
  const { code } = await run('p4', [...p4Args(cfg), 'login', '-s'], undefined, true);
  return code === 0;
}

export async function p4Sync(
  cfg: P4GitConfig,
  stream: string,
  paths: string[],
  force = false,
  onLine?: (line: string) => void
): Promise<boolean> {
  const sc = getStream(cfg, stream);
  if (!sc) return false;
  const client = sc.client;
  const cwd = sc.root + '/ProjectX';

  if (force) {
    for (const p of paths) {
      const { code } = await run('p4', [...p4Args(cfg), '-c', client, 'clean', p], cwd, true);
      if (code !== 0) return false;
    }
  }

  for (const p of paths) {
    const { code, stdout } = await run('p4', [...p4Args(cfg), '-c', client, 'sync', p], cwd, true);
    if (code !== 0) return false;
    if (onLine) {
      const updated = stdout.split('\n').filter(l =>
        l.includes('updating') || l.includes('added') || l.includes('refreshing')
      ).length;
      onLine(`[INFO] 同步 ${p}: ${updated > 0 ? `${updated} 个文件` : '无变更'}`);
    }
  }
  return true;
}

export async function p4Fstat(
  cfg: P4GitConfig,
  stream: string,
  file: string
): Promise<{ haveRev: number; headRev: number } | null> {
  const sc = getStream(cfg, stream);
  if (!sc) return null;
  const cwd = sc.root + '/ProjectX';
  const { stdout } = await run('p4', [...p4Args(cfg), '-c', sc.client, 'fstat', file], cwd, true);
  let haveRev = 0, headRev = 0;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (t.startsWith('... haveRev ')) haveRev = parseInt(t.slice('... haveRev '.length), 10);
    if (t.startsWith('... headRev ')) headRev = parseInt(t.slice('... headRev '.length), 10);
  }
  return { haveRev, headRev };
}

export async function p4GetOpenedFiles(
  cfg: P4GitConfig,
  stream: string
): Promise<string[]> {
  const sc = getStream(cfg, stream);
  if (!sc) return [];
  const cwd = sc.root + '/ProjectX';
  const { stdout } = await run('p4', [...p4Args(cfg), '-c', sc.client, 'opened'], cwd, true);
  return stdout.split('\n').filter(Boolean).map(l => {
    const m = l.match(/^(.+?)#\d+/);
    return m ? m[1].trim() : '';
  }).filter(Boolean);
}

export async function p4CreateChangelist(
  cfg: P4GitConfig,
  stream: string,
  description: string,
  files: string[]
): Promise<number> {
  const sc = getStream(cfg, stream);
  if (!sc) return -1;
  const cwd = sc.root + '/ProjectX';

  // 描述中的换行需要加 tab 缩进，这是 p4 spec 格式要求
  const descLines = description.split('\n').map(l => '\t' + l).join('\n');
  const fileLines = files.map(f => `\t${f}`).join('\n');
  const spec =
    `Change: new\n` +
    `Client: ${sc.client}\n` +
    `User: ${cfg.p4_user}\n` +
    `Status: new\n` +
    `Description:\n${descLines}\n` +
    (files.length > 0 ? `Files:\n${fileLines}\n` : '');

  const { stdout } = await run(
    'p4',
    [...p4Args(cfg), '-c', sc.client, 'change', '-i'],
    cwd,
    true,
    spec
  );
  const m = stdout.match(/Change (\d+) created/);
  return m ? parseInt(m[1], 10) : -1;
}

export async function p4OpenP4V(
  cfg: P4GitConfig,
  stream: string,
  changelist: number
): Promise<{ ok: boolean; error?: string }> {
  const sc = getStream(cfg, stream);
  if (!sc) return { ok: false, error: `stream ${stream} 未配置` };
  // p4v 是 GUI 程序，detached + unref 不等它退出；但要捕获 spawn 失败
  const { spawn } = await import('child_process');
  return new Promise((resolve) => {
    const proc = spawn(
      'p4v',
      ['-p', cfg.p4_port, '-u', cfg.p4_user, '-c', sc.client, '-s', `change:${changelist}`],
      { detached: true, stdio: 'ignore', windowsHide: false }
    );
    let settled = false;
    proc.once('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: err.message });
    });
    proc.once('spawn', () => {
      if (settled) return;
      settled = true;
      proc.unref();
      resolve({ ok: true });
    });
    // 兜底：1.5 秒内既没有 error 也没有 spawn，认为已启动
    setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.unref(); } catch {}
      resolve({ ok: true });
    }, 1500);
  });
}

/**
 * p4 sync -k：只更新 have 记录，不下载文件。
 * 用于在 git checkout / merge / apply 等改变工作区文件内容之后，对齐 P4 的 have 表，
 * 避免 p4 reconcile 时产生大量假改动。
 */
export async function p4SyncKeep(
  cfg: P4GitConfig,
  stream: string
): Promise<boolean> {
  const sc = getStream(cfg, stream);
  if (!sc) return false;
  const cwd = sc.root + '/ProjectX';
  const { code } = await run(
    'p4',
    [...p4Args(cfg), '-c', sc.client, 'sync', '-k', '...'],
    cwd,
    true
  );
  return code === 0;
}

/**
 * 对具体文件列表做 reconcile，直接指定 CL。
 * 只处理真正改动的文件，不扫描整个目录。
 */
export async function p4ReconcileFiles(
  cfg: P4GitConfig,
  stream: string,
  cl: number,
  files: string[],
  log: (line: string) => void
): Promise<boolean> {
  const sc = getStream(cfg, stream);
  if (!sc) return false;
  const cwd = sc.root + '/ProjectX';

  for (const file of files) {
    const { code, stderr } = await run(
      'p4',
      [...p4Args(cfg), '-c', sc.client, 'reconcile', '-c', String(cl), file],
      cwd,
      true
    );
    if (code !== 0 && !stderr.includes('no file(s) to reconcile')) {
      log(`[ERROR] reconcile 失败: ${file}: ${stderr}`);
      return false;
    }
  }
  return true;
}
