import path from 'path';
import fs from 'fs';
import { loadConfig, repoPath, getStream } from './config';
import * as git from './git';
import * as p4 from './p4';
import { run } from './runner';
import { LogFn, snapshotToMirror, gitTag } from './internal';

// -------------------------------------------------------
// Align Git（用户已在 P4V 手动 sync，只需更新 Git 记录）
// -------------------------------------------------------

export async function alignGit(
  rootDir: string, stream: string, log: LogFn
): Promise<{ ok: boolean; conflicts?: string[] }> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return { ok: false }; }
  const repo = repoPath(rootDir, stream);

  log('[INFO] 对齐 Git 记录...');

  // 把磁盘最新状态写入 mirror/p4（plumbing，不动工作区）
  const commitMsg = `sync: align git with P4 ${new Date().toISOString().slice(0, 16)}`;
  if (!await snapshotToMirror(repo, 'all', commitMsg, log)) {
    log('[ERROR] 更新 mirror/p4 失败'); return { ok: false };
  }

  // 3. 直接把 dev 指向 mirror/p4（对齐 = 以磁盘为准，不做 merge）
  const curBranch = await git.currentBranch(repo);
  if (!curBranch) { log('[ERROR] 无法获取当前分支'); return { ok: false }; }

  const mirrorHash = await git.revParse(repo, 'mirror/p4');
  if (!mirrorHash) { log('[ERROR] 无法获取 mirror/p4 HEAD'); return { ok: false }; }

  const devHash = await git.revParse(repo, 'HEAD');

  // 如果 dev 和 mirror/p4 已经一致，不需要操作
  if (devHash === mirrorHash) {
    log('[INFO] dev 已与 mirror/p4 一致，无需对齐');
  } else {
    // 创建 merge commit 保留历史关系，但 tree 使用 mirror/p4 的（即磁盘当前状态）
    const mirrorTree = await git.revParse(repo, 'mirror/p4^{tree}');
    const { stdout: commitOut } = await run(
      'git', ['commit-tree', mirrorTree, '-p', devHash, '-p', mirrorHash, '-m', commitMsg],
      repo, true
    );
    const newCommit = commitOut.trim();
    if (!newCommit) { log('[ERROR] commit-tree 失败'); return { ok: false }; }

    if (!await git.updateRef(repo, curBranch, newCommit)) {
      log('[ERROR] update-ref 失败'); return { ok: false };
    }
    await run('git', ['read-tree', newCommit], repo, true);
  }

  await run('git', ['update-index', '--refresh'], repo, true);

  // 打 p4-sync tag
  await gitTag(repo, 'p4-sync');

  log('[OK] Git 已对齐，mirror/p4 和 dev 均已更新');
  return { ok: true };
}

/**
 * 冲突解决后继续对齐（用户手动解决冲突后调用）
 */
export async function alignGitContinue(
  rootDir: string, stream: string, resolution: 'ours' | 'theirs' | 'manual', log: LogFn
): Promise<{ ok: boolean; resolvedFiles?: string[] }> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return { ok: false }; }
  const repo = repoPath(rootDir, stream);

  // 必须处于 merge 冲突状态才能继续对齐，否则 --theirs/--ours 会失败且错误路径不清
  if (!fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD'))) {
    log('[ERROR] 当前工作区不在 merge 状态，无法继续对齐'); return { ok: false };
  }

  // 获取冲突文件列表
  const conflicts = await git.conflictFiles(repo);

  if (resolution === 'theirs') {
    // 使用 P4 版本
    for (const f of conflicts) {
      await run('git', ['checkout', '--theirs', '--', f], repo, true);
      log(`[INFO] 使用 P4 版本: ${f}`);
    }
  } else if (resolution === 'ours') {
    // 使用本地版本
    for (const f of conflicts) {
      await run('git', ['checkout', '--ours', '--', f], repo, true);
      log(`[INFO] 使用本地版本: ${f}`);
    }
  }
  // manual: 用户已手动解决，直接继续

  // 只 add 冲突文件，避免把用户在冲突解决期间动过的其他文件混进 merge commit
  if (conflicts.length > 0) {
    await run('git', ['add', '--', ...conflicts], repo, true);
  }
  const { code, stderr } = await run(
    'git', ['commit', '-m', `sync: resolve conflicts and align with P4 ${new Date().toISOString().slice(0, 16)}`],
    repo, true
  );
  if (code !== 0) {
    log(`[ERROR] git commit 失败: ${stderr}`); return { ok: false };
  }

  // 打 p4-sync tag
  await gitTag(repo, 'p4-sync');

  log('[OK] 冲突已解决，Git 对齐完成');
  return { ok: true, resolvedFiles: conflicts };
}
