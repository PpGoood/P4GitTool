import { loadConfig, repoPath, getStream } from './config';
import * as git from './git';
import * as p4 from './p4';
import { run } from './runner';
import { parseUnifiedDiff, DiffFile } from './diff';
import { getQueue } from './queue';
import { LogFn } from './internal';
import { getChangedFiles, ChangedFile } from './changes';

// -------------------------------------------------------
// 历史浏览（不改变工作区）
// -------------------------------------------------------

/**
 * 获取某个历史节点相比上一个节点的改动文件列表（纯读操作，不改变工作区）
 */
export async function getNodeFiles(
  rootDir: string, stream: string, hash: string, parentHash: string
): Promise<ChangedFile[]> {
  const repo = repoPath(rootDir, stream);
  if (!parentHash) return [];
  const { stdout } = await run(
    'git', ['diff', '--name-status', parentHash, hash], repo, true
  );
  const map = new Map<string, ChangedFile>();
  for (const line of stdout.split('\n').filter(Boolean)) {
    const parts = line.split(/\t+/);
    const code = parts[0]?.[0] ?? '?';
    const p = parts[parts.length - 1] ?? '';
    if (!p) continue;
    const status = (['M', 'A', 'D', 'R'].includes(code) ? code : '?') as ChangedFile['status'];
    map.set(p, { path: p, status });
  }
  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * 获取某个历史节点某文件的 diff（纯读操作，不改变工作区）
 */
export async function getNodeFileDiff(
  rootDir: string, stream: string,
  hash: string, parentHash: string, filepath: string
): Promise<DiffFile | null> {
  const repo = repoPath(rootDir, stream);
  if (!parentHash) return null;
  const { stdout } = await run(
    'git', ['diff', parentHash, hash, '--', filepath], repo, true
  );
  if (!stdout.trim()) return null;
  const files = parseUnifiedDiff(stdout);
  return files[0] ?? null;
}

// -------------------------------------------------------
// Checkout 历史 / 回到最新
// -------------------------------------------------------

/**
 * Checkout 到历史节点（detached HEAD），用于验证问题。
 * 文件变成那个状态，分支指针不动，随时可以 returnToLatest 回来。
 * 前置条件：工作区必须干净。
 */
export async function checkoutHistoryNode(
  rootDir: string, stream: string, hash: string, log: LogFn
): Promise<boolean> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return false; }
  const repo = repoPath(rootDir, stream);
  const queue = getQueue(repo);
  return queue.enqueue(async () => {
    if (!await git.gitCheckClean(repo)) {
      log('[ERROR] 工作区有未提交的改动，请先提交快照或丢弃改动');
      return false;
    }

    // 判断目标是否是 stream 分支最新：是则 checkout 分支（退出 detached），
    // 否则 checkout hash（进入 detached）
    const { stdout: streamHashOut } = await run(
      'git', ['rev-parse', stream], repo, true
    );
    const streamHash = streamHashOut.trim();
    const target = hash === streamHash ? stream : hash;

    const t0 = Date.now();
    const { code, stderr } = await run('git', ['checkout', target], repo, true);
    log(`[PERF] git checkout ${target === stream ? stream : target.slice(0, 7)}: ${Date.now() - t0}ms`);
    if (code !== 0) { log(`[ERROR] git checkout 失败: ${stderr}`); return false; }

    // 如果切回了 stream 分支，执行 p4 sync -k 对齐 have
    if (target === stream) {
      await p4.p4SyncKeep(cfg, stream);
    }

    log(`[OK] 已切换到 ${target === stream ? '最新工作分支' : `历史节点 ${hash.slice(0, 7)}`}`);
    return true;
  });
}

/**
 * 回到最新工作分支（从 detached HEAD 回来）。
 * - force=false：检测到改动就返回 hasChanges，不执行
 * - force=true：强制 checkout，丢弃所有改动
 */
export async function returnToLatest(
  rootDir: string, stream: string, force: boolean, log: LogFn
): Promise<{ ok: boolean; hasChanges?: boolean; changes?: ChangedFile[] }> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return { ok: false }; }
  const repo = repoPath(rootDir, stream);
  const queue = getQueue(repo);
  return queue.enqueue(async () => {
    // 非强制：先检查是否有未提交改动
    if (!force) {
      if (!await git.gitCheckClean(repo)) {
        const changes = await getChangedFiles(rootDir, stream);
        return { ok: false, hasChanges: true, changes };
      }
    }

    // 强制模式：丢弃所有改动
    if (force) {
      await run('git', ['checkout', '--', '.'], repo, true);
      await run('git', ['clean', '-fd'], repo, true);
    }

    const { code, stderr } = await run('git', ['checkout', stream], repo, true);
    if (code !== 0) { log(`[ERROR] git checkout ${stream} 失败: ${stderr}`); return { ok: false }; }
    await p4.p4SyncKeep(cfg, stream);
    log('[OK] 已回到最新工作状态');
    return { ok: true };
  });
}
