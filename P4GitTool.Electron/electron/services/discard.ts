import fs from 'fs';
import path from 'path';
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
 * 还原单个文件到上个快照（HEAD）的状态。
 * - 文件在 HEAD 中存在 → git checkout HEAD -- <file>，恢复内容且不留在暂存区
 * - 文件不在 HEAD（新增/未跟踪）→ 上个快照时不存在，还原 = 删除该文件
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
    // 文件是否在 HEAD（上个快照）中被跟踪
    const { code: tracked } = await run(
      'git', ['cat-file', '-e', `HEAD:${filepath}`], repo, true
    );

    if (tracked === 0) {
      // 在 HEAD 中：checkout 回上个快照的内容（同时更新工作区和暂存区，不留 staged）
      const { code } = await run('git', ['checkout', 'HEAD', '--', filepath], repo, true);
      if (code !== 0) { log(`[ERROR] 还原 ${filepath} 失败`); return false; }
    } else {
      // 不在 HEAD（新增文件）：还原 = 删除。先从暂存区移除（若已 add），再删磁盘文件
      await run('git', ['rm', '-f', '--quiet', '--', filepath], repo, true);
      const abs = path.join(repo, filepath);
      if (fs.existsSync(abs)) {
        try { fs.rmSync(abs); } catch { /* 忽略 */ }
      }
    }
    log(`[OK] ${filepath} 已还原到上个快照`);
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
    await p4.p4SyncKeep(cfg, stream, [filepath]);
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
    await p4.p4SyncKeep(cfg, stream, [filepath]);
    log(`[OK] ${filepath} 的行改动已撤销`);
    return true;
  });
}
