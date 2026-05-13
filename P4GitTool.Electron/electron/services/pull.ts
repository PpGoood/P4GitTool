import { loadConfig, repoPath, getStream } from './config';
import * as git from './git';
import * as p4 from './p4';
import { run } from './runner';
import { LogFn, scopePaths, snapshotToMirror, gitTag } from './internal';

// -------------------------------------------------------
// Pull
// -------------------------------------------------------

export async function pull(
  rootDir: string, stream: string, scope: string, mode: string,
  log: LogFn
): Promise<boolean> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return false; }

  const repo = repoPath(rootDir, stream);

  // detached HEAD 下执行 pull 会让中间快照 commit 变 dangling，先拒绝
  const curBranchName = await git.currentBranch(repo);
  if (!curBranchName) {
    log('[ERROR] 当前处于历史查看模式（detached HEAD），请先点状态栏"返回工作区"再执行 P4 Sync');
    return false;
  }

  if (!await p4.p4Login(cfg)) { log('[ERROR] P4 登录失败'); return false; }

  // Sync 前保护：若工作区有未提交改动，先 commit 一个快照
  const dirty = !(await git.gitCheckClean(repo));
  if (dirty) {
    log('[INFO] 检测到未提交改动，自动创建 Sync 前保护快照...');
    await run('git', ['add', '-A'], repo, true);
    if (!await git.gitCommit(repo, `sync-protect: auto snapshot before sync ${new Date().toISOString()}`)) {
      log('[ERROR] Sync 前保护提交失败'); return false;
    }
    log('[OK] Sync 前保护快照已创建');
  }

  log(`[INFO] 正在从 P4 同步代码 (范围: ${scope}, 模式: ${mode})...`);
  if (!await p4.p4Sync(cfg, stream, scopePaths(scope), mode === 'force', log)) return false;

  // 更新 mirror/p4（plumbing，不切换分支）
  const commitMsg = `sync: P4 ${stream} ${scope}`;
  if (!await snapshotToMirror(repo, scope, commitMsg, log)) return false;

  // 合并 mirror/p4 -> 当前分支（stream 名）
  log(`[INFO] 正在合并 mirror/p4 → ${curBranchName}...`);
  if (!await git.gitMerge(repo, 'mirror/p4')) {
    log('[ERROR] 合并有冲突，请在 Fork 或命令行中手动解决');
    return false;
  }

  // 收尾：对齐 P4 have 记录
  if (!await p4.p4SyncKeep(cfg, stream)) {
    log('[WARN] p4 sync -k 失败，have 记录可能不一致');
  }

  // 打 p4-sync tag，时间线显示蓝色节点
  await gitTag(repo, 'p4-sync');

  log(`[OK] Pull 完成`);
  return true;
}
