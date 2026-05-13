import { loadConfig, repoPath, getStream } from './config';
import * as git from './git';
import * as p4 from './p4';
import { run } from './runner';
import { parseUnifiedDiff, buildHunkReversePatch, buildLineReversePatch, DiffFile } from './diff';
import { getQueue } from './queue';
import { LogFn } from './internal';

// -------------------------------------------------------
// Discard 操作
// -------------------------------------------------------

/**
 * 还原单个文件到 mirror/p4 的版本。
 */
export async function discardFile(
  rootDir: string, stream: string, filepath: string, log: LogFn
): Promise<boolean> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return false; }
  const repo = repoPath(rootDir, stream);
  const queue = getQueue(repo);

  return queue.enqueue(async () => {
    if (!await git.gitCheckoutFile(repo, 'mirror/p4', filepath)) {
      log(`[ERROR] 还原 ${filepath} 失败`); return false;
    }
    await p4.p4SyncKeep(cfg, stream);
    log(`[OK] ${filepath} 已还原到 P4 版本`);
    return true;
  });
}

async function findFileHunk(
  repo: string, filepath: string, hunkIndex: number
): Promise<{ file: DiffFile; hunkIndex: number } | null> {
  const { stdout } = await run('git', ['diff', 'mirror/p4', '--', filepath], repo, true);
  const files = parseUnifiedDiff(stdout);
  if (!files.length || hunkIndex < 0 || hunkIndex >= files[0].hunks.length) return null;
  return { file: files[0], hunkIndex };
}

/**
 * 撤销某文件的某个 hunk。
 */
export async function discardHunk(
  rootDir: string, stream: string, filepath: string, hunkIndex: number, log: LogFn
): Promise<boolean> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return false; }
  const repo = repoPath(rootDir, stream);
  const queue = getQueue(repo);

  return queue.enqueue(async () => {
    const info = await findFileHunk(repo, filepath, hunkIndex);
    if (!info) { log('[ERROR] 未找到指定 hunk'); return false; }

    const patch = buildHunkReversePatch(info.file, info.file.hunks[hunkIndex]);
    if (!await git.applyReversePatch(repo, patch)) {
      log('[ERROR] git apply --reverse 失败'); return false;
    }
    await p4.p4SyncKeep(cfg, stream);
    log(`[OK] ${filepath} 的 hunk #${hunkIndex} 已撤销`);
    return true;
  });
}

/**
 * 撤销某 hunk 中的单行改动。
 */
export async function discardLine(
  rootDir: string, stream: string, filepath: string,
  hunkIndex: number, lineIndex: number, log: LogFn
): Promise<boolean> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return false; }
  const repo = repoPath(rootDir, stream);
  const queue = getQueue(repo);

  return queue.enqueue(async () => {
    const info = await findFileHunk(repo, filepath, hunkIndex);
    if (!info) { log('[ERROR] 未找到指定 hunk'); return false; }

    const patch = buildLineReversePatch(info.file, info.file.hunks[hunkIndex], lineIndex);
    if (!await git.applyReversePatch(repo, patch)) {
      log('[ERROR] git apply --reverse 失败'); return false;
    }
    await p4.p4SyncKeep(cfg, stream);
    log(`[OK] ${filepath} 的行改动已撤销`);
    return true;
  });
}
