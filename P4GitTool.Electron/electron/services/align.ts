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

  log('[INFO] 对齐 Git 记录（不下载文件）...');

  // p4 sync -k 更新 have 记录
  if (!await p4.p4SyncKeep(cfg, stream)) {
    log('[WARN] p4 sync -k 失败，have 记录可能不一致');
  }

  // 把磁盘最新状态写入 mirror/p4
  const commitMsg = `sync: align git with P4 ${new Date().toISOString().slice(0, 16)}`;
  if (!await snapshotToMirror(repo, 'all', commitMsg, log)) {
    log('[ERROR] 更新 mirror/p4 失败'); return { ok: false };
  }

  // merge mirror/p4 → dev
  if (!await git.gitMerge(repo, 'mirror/p4')) {
    // merge 失败，获取冲突文件列表
    const conflicts = await git.conflictFiles(repo);
    log(`[ERROR] 发现 ${conflicts.length} 个冲突文件，请解决后点击"继续对齐"`);
    conflicts.forEach(f => log(`  冲突: ${f}`));
    return { ok: false, conflicts };
  }

  // 打 p4-sync tag，时间线显示蓝色节点
  await gitTag(repo, 'p4-sync');

  log('[OK] Git 已对齐，mirror/p4 和 dev 均已更新');
  return { ok: true };
}

/**
 * 冲突解决后继续对齐（用户手动解决冲突后调用）
 */
export async function alignGitContinue(
  rootDir: string, stream: string, resolution: 'ours' | 'theirs' | 'manual', log: LogFn
): Promise<{ ok: boolean }> {
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
  return { ok: true };
}
