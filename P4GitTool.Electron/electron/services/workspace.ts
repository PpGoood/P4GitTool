import path from 'path';
import fs from 'fs';
import { loadConfig, repoPath } from './config';
import * as git from './git';
import { run } from './runner';
import { LogFn, ensureJunction } from './internal';
import { ensureTemplates, syncConfig, writeInitIgnoreFiles } from './templates';

// -------------------------------------------------------
// Init
// -------------------------------------------------------

export async function init(rootDir: string, log: LogFn): Promise<boolean> {
  const cfg = loadConfig();
  ensureTemplates(rootDir);

  for (const sc of cfg.streams) {
    const stream = sc.name;
    log(`[INFO] 正在初始化工作区: ${stream}`);
    const repo = repoPath(rootDir, stream);
    const p4r = path.join(sc.root, 'ProjectX');

    fs.mkdirSync(repo, { recursive: true });

    const gitDir = path.join(repo, '.git');
    if (!fs.existsSync(gitDir)) {
      const initRes = await run('git', ['init', '-b', 'mirror/p4'], repo, true);
      log(`[INFO] git init: ${initRes.code === 0 ? 'OK' : initRes.stderr}`);
      await run('git', ['config', 'user.email', 'p4git@local'], repo, true);
      await run('git', ['config', 'user.name', 'P4Git Tool'], repo, true);
      await run('git', ['config', 'core.quotepath', 'false'], repo, true);
      await run('git', ['config', 'core.symlinks', 'false'], repo, true);
      await run('git', ['config', 'i18n.logOutputEncoding', 'utf-8'], repo, true);
      await run('git', ['config', 'i18n.commitEncoding', 'utf-8'], repo, true);
      writeInitIgnoreFiles(rootDir, repo);
      await run('git', ['add', '.gitignore', '.gitattributes'], repo, true);
      await run('git', ['commit', '-m', `init: ${stream} workspace`], repo, true);
    } else {
      // 已有 .git，确保 symlinks 配置正确
      await run('git', ['config', 'core.symlinks', 'false'], repo, true);
      log(`[INFO] ${stream} .git 已存在，跳过 git init`);
    }

    fs.mkdirSync(path.join(repo, 'Content'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'Saved'), { recursive: true });

    await ensureJunction(repo, 'Source', path.join(p4r, 'Source'), log);
    await ensureJunction(repo, path.join('Content', 'Script'), path.join(p4r, 'Content', 'Script'), log);
    await ensureJunction(repo, path.join('Saved', 'Logs'), path.join(p4r, 'Saved', 'Logs'), log);

    // 等待文件系统就绪（Junction 创建后 git 需要时间扫描）
    log('[INFO] 等待文件系统就绪...');
    await new Promise(r => setTimeout(r, 1000));

    // 确认 Junction 里有文件才 add
    const sourceDir = path.join(repo, 'Source');
    const sourceFiles = fs.existsSync(sourceDir) ? fs.readdirSync(sourceDir) : [];
    log(`[INFO] Source 目录文件数: ${sourceFiles.length}`);

    const { stdout: statusOut } = await run('git', ['status', '--porcelain'], repo, true);
    log(`[INFO] git status 行数: ${statusOut.split('\n').filter(Boolean).length}`);

    await run('git', ['add', '-A'], repo, true);
    const { code: diffCode } = await run('git', ['diff', '--cached', '--quiet'], repo, true);
    if (diffCode !== 0) {
      const { code: commitCode, stderr: commitErr } = await run(
        'git', ['commit', '-m', `init: ${stream} initial snapshot`], repo, true
      );
      if (commitCode === 0) {
        log(`[OK] ${stream} 初始快照已提交`);
      } else {
        log(`[ERROR] ${stream} 初始快照提交失败: ${commitErr}`);
      }
    } else {
      log(`[INFO] ${stream} 无新文件需要提交`);
    }

    if (!await git.branchExists(repo, stream)) {
      await git.gitCheckout(repo, 'mirror/p4');
      await run('git', ['checkout', '-b', stream], repo, true);
    } else {
      await git.gitCheckout(repo, stream);
    }

    // 同步 Agent 规则(CLAUDE.md)、MCP、技能到工作区（.gitignore/.gitattributes 已在首次提交时写入）
    try {
      await syncConfig(rootDir, stream);
      log(`[OK] ${stream} Agent 配置已同步`);
    } catch (e: any) {
      log(`[WARN] ${stream} Agent 配置同步失败: ${e.message}`);
    }

    log(`[OK] ${stream} 初始化完成，当前分支: ${stream}`);
  }

  log('[OK] 所有工作区初始化完成');
  return true;
}

// -------------------------------------------------------
// 状态查询
// -------------------------------------------------------

export async function getStreamStatus(rootDir: string, stream: string) {
  const repo = repoPath(rootDir, stream);
  const hasGitDir = fs.existsSync(path.join(repo, '.git'));
  const sourceJunc = fs.existsSync(path.join(repo, 'Source'));

  const gitInited = hasGitDir && await git.branchExists(repo, stream);
  const branch = hasGitDir ? await git.currentBranch(repo) : '';
  const branches = hasGitDir ? await git.listBranches(repo) : [];

  // 当前 HEAD 的 hash，用于时间线高亮当前节点
  let headHash = '';
  if (hasGitDir) {
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], repo, true);
    headHash = stdout.trim();
  }

  // 是否处于 detached HEAD（查看历史节点模式）
  const isDetached = hasGitDir && branch === '';

  // 是否处于 merge 冲突状态（上次对齐或 Sync 未完成）
  const inMergeConflict = hasGitDir && fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD'));
  let mergeConflictFiles: string[] = [];
  if (inMergeConflict) {
    mergeConflictFiles = await git.conflictFiles(repo);
  }

  return {
    gitInited, junctionOk: sourceJunc, branch, branches,
    headHash, isDetached, inMergeConflict, mergeConflictFiles,
  };
}
