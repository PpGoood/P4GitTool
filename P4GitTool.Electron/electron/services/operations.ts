import path from 'path';
import fs from 'fs';
import { loadConfig, repoPath, p4Root, getStream } from './config';
import * as git from './git';
import * as p4 from './p4';
import { run } from './runner';

export type LogFn = (line: string) => void;

// -------------------------------------------------------
// 工具方法
// -------------------------------------------------------

function scopePaths(scope: string): string[] {
  switch (scope) {
    case 'cpp': return ['Source/...'];
    case 'lua': return ['Content/Script/...'];
    case 'all': return ['Source/...', 'Content/Script/...'];
    case 'project': return ['...'];
    default: return [];
  }
}

function scopeTargets(scope: string): string[] {
  switch (scope) {
    case 'cpp': return ['Source'];
    case 'lua': return ['Content/Script'];
    case 'all': return ['Source', 'Content/Script'];
    case 'project': return ['Source', 'Content', 'Config'];
    default: return [];
  }
}

// -------------------------------------------------------
// 快照到 mirror/p4（不切换分支）
// -------------------------------------------------------

export async function snapshotToMirror(
  repo: string, scope: string, commitMsg: string, log: LogFn
): Promise<boolean> {
  if (!await git.readTree(repo, 'mirror/p4')) {
    log('[ERROR] git read-tree mirror/p4 失败'); return false;
  }

  await git.gitAdd(repo, scopeTargets(scope));

  const { stdout: statusOut } = await run('git', ['status', '--porcelain'], repo, true);
  if (!statusOut.trim()) {
    log('[INFO] P4 无新变更');
    await run('git', ['read-tree', 'HEAD'], repo, true);
    return true;
  }

  const treeHash = await git.writeTree(repo);
  if (!treeHash) { log('[ERROR] git write-tree 失败'); return false; }

  const mirrorHash = await git.revParse(repo, 'mirror/p4');
  if (!mirrorHash) { log('[ERROR] 无法获取 mirror/p4 HEAD'); return false; }

  const commitHash = await git.commitTree(repo, treeHash, mirrorHash, commitMsg);
  if (!commitHash) { log('[ERROR] git commit-tree 失败'); return false; }

  if (!await git.updateRef(repo, 'mirror/p4', commitHash)) {
    log('[ERROR] 更新 mirror/p4 引用失败'); return false;
  }

  await run('git', ['read-tree', 'HEAD'], repo, true);
  log('[OK] P4 快照已更新');
  return true;
}

// -------------------------------------------------------
// 无冲突时不切换分支完成 merge
// -------------------------------------------------------

export async function mergeBranchNoSwitch(
  repo: string, src: string, dst: string, log: LogFn,
  onConflict?: () => Promise<boolean>
): Promise<boolean> {
  const mbHash = await git.mergeBase(repo, src, dst);
  const srcHash = await git.revParse(repo, src);
  const dstHash = await git.revParse(repo, dst);

  if (mbHash === srcHash) { log(`[INFO] ${dst} 已是最新`); return true; }

  if (mbHash === dstHash) {
    await git.updateRef(repo, dst, srcHash);
    log(`[OK] ${dst} fast-forward 到 ${src}`);
    return true;
  }

  const { tree, hasConflict } = await git.mergeTree(repo, dst, src);

  if (!hasConflict) {
    const mergeHash = await git.commitTree(repo, tree, dstHash, `update: merge ${src} into ${dst}`);
    // merge commit 需要两个 parent
    const { stdout } = await run('git', ['commit-tree', tree, '-p', dstHash, '-p', srcHash, '-m', `update: merge ${src} into ${dst}`], repo, true);
    const hash = stdout.trim();
    if (!hash) { log(`[ERROR] commit-tree 失败: ${src} -> ${dst}`); return false; }
    await git.updateRef(repo, dst, hash);
    log(`[OK] ${dst} 已合并 ${src}`);
    return true;
  }

  // 有冲突，切换到 dst 处理
  log(`[WARN] ${src} → ${dst} 存在冲突，切换分支处理...`);
  const curBranch = await git.currentBranch(repo);
  if (!await git.gitCheckout(repo, dst)) { log('[ERROR] 切换分支失败'); return false; }
  if (!await git.gitMerge(repo, src)) {
    if (onConflict) {
      const resolved = await onConflict();
      if (!resolved) return false;
    } else {
      log('[ERROR] 合并冲突，需要手动解决');
      return false;
    }
  }
  if (curBranch !== dst) await git.gitCheckout(repo, curBranch);
  return true;
}

export async function mergeForward(
  repo: string, from: string, baseBranch: string, originBranch: string,
  log: LogFn, onConflict?: () => Promise<boolean>
): Promise<boolean> {
  if (!await mergeBranchNoSwitch(repo, from, baseBranch, log, onConflict)) return false;
  if (originBranch !== baseBranch) {
    if (!await mergeBranchNoSwitch(repo, baseBranch, originBranch, log, onConflict)) return false;
  }
  return true;
}

// -------------------------------------------------------
// Init
// -------------------------------------------------------

export async function init(rootDir: string, log: LogFn): Promise<boolean> {
  const cfg = loadConfig();

  for (const sc of cfg.streams) {
    const stream = sc.name;
    log(`[INFO] 正在初始化工作区: ${stream}`);
    const repo = repoPath(rootDir, stream);
    const p4r = path.join(sc.root, 'ProjectX');

    fs.mkdirSync(repo, { recursive: true });

    const gitDir = path.join(repo, '.git');
    if (!fs.existsSync(gitDir)) {
      await run('git', ['init', '-b', 'mirror/p4'], repo, true);
      await run('git', ['config', 'core.quotepath', 'false'], repo, true);
      await run('git', ['config', 'i18n.logOutputEncoding', 'utf-8'], repo, true);
      await run('git', ['config', 'i18n.commitEncoding', 'utf-8'], repo, true);
      writeGitIgnore(repo);
      writeGitAttributes(repo);
      await run('git', ['add', '.gitignore', '.gitattributes'], repo, true);
      await run('git', ['commit', '-m', `build: 初始化 ${stream} P4 工作区`], repo, true);
    }

    fs.mkdirSync(path.join(repo, 'Content'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'Saved'), { recursive: true });

    await ensureJunction(repo, 'Source', path.join(p4r, 'Source'), log);
    await ensureJunction(repo, path.join('Content', 'Script'), path.join(p4r, 'Content', 'Script'), log);
    await ensureJunction(repo, path.join('Saved', 'Logs'), path.join(p4r, 'Saved', 'Logs'), log);

    await run('git', ['add', '-A'], repo, true);
    const { code: diffCode } = await run('git', ['diff', '--cached', '--quiet'], repo, true);
    if (diffCode !== 0) {
      await run('git', ['commit', '-m', `build: 导入 ${stream} P4 初始快照`], repo, true);
      log(`[OK] ${stream} 初始快照已提交`);
    }

    if (!await git.branchExists(repo, stream)) {
      await git.gitCheckout(repo, 'mirror/p4');
      await run('git', ['checkout', '-b', stream], repo, true);
    } else {
      await git.gitCheckout(repo, stream);
    }

    log(`[OK] ${stream} 初始化完成，当前分支: ${stream}`);
  }

  log('[OK] 所有工作区初始化完成');
  return true;
}

// -------------------------------------------------------
// Pull
// -------------------------------------------------------

export async function pull(
  rootDir: string, stream: string, scope: string, mode: string,
  log: LogFn, onConflict?: () => Promise<boolean>
): Promise<boolean> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return false; }

  const repo = repoPath(rootDir, stream);

  if (!await p4.p4Login(cfg)) { log('[ERROR] P4 登录失败'); return false; }
  if (!await git.gitCheckClean(repo)) { log('[ERROR] 工作区有未提交的改动，请先处理'); return false; }

  const originBranch = await git.currentBranch(repo);
  const baseBranch = stream;

  log(`[INFO] 正在从 P4 同步代码 (范围: ${scope}, 模式: ${mode})...`);
  if (!await p4.p4Sync(cfg, stream, scopePaths(scope), mode === 'force', log)) return false;

  const commitMsg = `update: 同步P4 ${stream} ${scope}代码`;
  if (!await snapshotToMirror(repo, scope, commitMsg, log)) return false;
  if (!await mergeForward(repo, 'mirror/p4', baseBranch, originBranch, log, onConflict)) return false;

  log(`[OK] Pull 完成，当前分支: ${await git.currentBranch(repo)}`);
  return true;
}

// -------------------------------------------------------
// 候选文件 & 过期检查
// -------------------------------------------------------

export async function buildCandidates(
  rootDir: string, stream: string
): Promise<string[]> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) return [];
  const repo = repoPath(rootDir, stream);
  const p4r = path.join(sc.root, 'ProjectX');

  const files = await git.diffNameOnly(repo, stream, 'HEAD');
  return files.filter(f =>
    f.startsWith('Source/') || f.startsWith('Source\\') ||
    f.startsWith('Content/Script/') || f.startsWith('Content\\Script\\')
  ).map(f => path.join(p4r, f.replace(/\//g, path.sep)));
}

export async function checkOutdated(
  rootDir: string, stream: string, candidates: string[]
): Promise<string[]> {
  const cfg = loadConfig();
  const outdated: string[] = [];
  await Promise.all(candidates.map(async (f) => {
    const stat = await p4.p4Fstat(cfg, stream, f);
    if (!stat || stat.haveRev < stat.headRev) outdated.push(f);
  }));
  return outdated;
}

// -------------------------------------------------------
// Check & Update
// -------------------------------------------------------

export async function checkAndUpdate(
  rootDir: string, stream: string, log: LogFn,
  onConflict?: () => Promise<boolean>
): Promise<'ready' | 'blocked' | 'conflict' | 'error'> {
  const cfg = loadConfig();
  const repo = repoPath(rootDir, stream);

  if (!await git.gitCheckClean(repo)) {
    log('[ERROR] 工作区有未提交的改动，请先 Commit 或 Stash');
    return 'error';
  }

  const candidates = await buildCandidates(rootDir, stream);
  if (candidates.length === 0) {
    log('[INFO] 没有候选文件，无需提交');
    return 'ready';
  }

  log(`[INFO] 候选文件 ${candidates.length} 个，检查 P4 版本...`);
  await p4.p4Clean(cfg, stream, ['Source/...', 'Content/Script/...']);

  const outdated = await checkOutdated(rootDir, stream, candidates);
  if (outdated.length === 0) {
    log('[OK] 所有文件状态正常，可以提交');
    return 'ready';
  }

  log(`[WARN] 发现 ${outdated.length} 个过期文件，正在同步...`);
  if (!await p4.p4SyncFiles(cfg, stream, outdated)) {
    log('[ERROR] 同步过期文件失败'); return 'error';
  }

  const commitMsg = `update: 同步P4 ${stream} 过期文件`;
  if (!await snapshotToMirror(repo, 'all', commitMsg, log)) return 'error';

  const curBranch = await git.currentBranch(repo);
  if (!await mergeForward(repo, 'mirror/p4', stream, curBranch, log, onConflict)) return 'conflict';

  log('[OK] 同步完成，重新检查状态...');
  return await checkAndUpdate(rootDir, stream, log, onConflict);
}

// -------------------------------------------------------
// Submit to P4V
// -------------------------------------------------------

export async function submitPrepare(
  rootDir: string, stream: string, log: LogFn
): Promise<boolean> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) return false;

  const candidates = await buildCandidates(rootDir, stream);
  if (candidates.length === 0) { log('[ERROR] 没有候选文件'); return false; }

  log(`[INFO] 正在 reconcile ${candidates.length} 个文件...`);
  await p4.p4Reconcile(cfg, stream, candidates);

  const cl = await p4.p4CreateChangelist(cfg, stream, '待提交', candidates);
  if (cl < 0) { log('[ERROR] 创建 Changelist 失败'); return false; }

  const curBranch = await git.currentBranch(repoPath(rootDir, stream));
  savePendingState(rootDir, { stream, featureBranch: curBranch, baseBranch: stream, changelist: cl, candidateFiles: candidates });

  log(`[OK] Changelist #${cl} 已创建，正在打开 P4V...`);
  await p4.p4OpenP4V(cfg, stream, cl);
  return true;
}

// -------------------------------------------------------
// Confirm Submit
// -------------------------------------------------------

export async function confirmSubmit(
  rootDir: string, log: LogFn, onConflict?: () => Promise<boolean>
): Promise<boolean> {
  const state = loadPendingState(rootDir);
  if (!state) { log('[ERROR] 没有待确认的提交记录'); return false; }

  const cfg = loadConfig();
  const { stream, featureBranch, baseBranch, candidateFiles, changelist } = state;
  const repo = repoPath(rootDir, stream);

  log(`[INFO] 正在同步已提交的 ${candidateFiles.length} 个文件...`);
  await p4.p4SyncFiles(cfg, stream, candidateFiles);

  const commitMsg = `update: 同步P4提交 ${stream} CL#${changelist}`;
  if (!await snapshotToMirror(repo, 'all', commitMsg, log)) return false;
  if (!await mergeForward(repo, 'mirror/p4', baseBranch, baseBranch, log, onConflict)) return false;

  log(`[INFO] 正在合并 ${featureBranch} → ${baseBranch}...`);
  if (!await mergeBranchNoSwitch(repo, featureBranch, baseBranch, log, onConflict)) return false;

  deletePendingState(rootDir);
  log('[OK] 提交完成');
  return true;
}

// -------------------------------------------------------
// Git 操作区
// -------------------------------------------------------

export async function getChangedFiles(rootDir: string, stream: string) {
  const repo = repoPath(rootDir, stream);
  return git.gitStatus(repo);
}

export async function commitChanges(rootDir: string, stream: string, message: string, log: LogFn): Promise<boolean> {
  const repo = repoPath(rootDir, stream);
  if (!message.trim()) { log('[ERROR] 提交信息不能为空'); return false; }
  await run('git', ['add', '-A'], repo, true);
  const { stdout } = await run('git', ['status', '--porcelain'], repo, true);
  if (!stdout.trim()) { log('[INFO] 没有改动可提交'); return false; }
  if (!await git.gitCommit(repo, message)) { log('[ERROR] Commit 失败'); return false; }
  log(`[OK] 已提交: ${message}`);
  return true;
}

export interface StashEntry {
  index: number;
  name: string;
  branch: string;
  stream: string;
  date: string;
}

function stashMsg(stream: string, branch: string, name: string) {
  return `[P4Git|${stream}|${branch}] ${name}`;
}

function parseStashLine(line: string): { index: number; stream: string; branch: string; name: string } | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx < 0) return null;
  const indexStr = line.slice(0, colonIdx).trim();
  if (!indexStr.startsWith('stash@{') || !indexStr.endsWith('}')) return null;
  const idx = parseInt(indexStr.slice(7, -1));
  if (isNaN(idx)) return null;

  const rest = line.slice(colonIdx + 1);
  const msgStart = rest.indexOf('[P4Git|');
  if (msgStart < 0) return null;

  const msgPart = rest.slice(msgStart);
  const tagEnd = msgPart.indexOf(']');
  if (tagEnd < 0) return null;

  const tag = msgPart.slice(1, tagEnd);
  const parts = tag.split('|');
  if (parts.length !== 3) return null;

  return { index: idx, stream: parts[1], branch: parts[2], name: msgPart.slice(tagEnd + 2).trim() };
}

export async function listStashes(rootDir: string, stream: string, branch: string): Promise<StashEntry[]> {
  const repo = repoPath(rootDir, stream);
  const lines = await git.gitStashList(repo);
  const dates = await git.gitReflogDates(repo);
  const result: StashEntry[] = [];

  for (const line of lines) {
    const parsed = parseStashLine(line);
    if (!parsed || parsed.stream !== stream || parsed.branch !== branch) continue;
    result.push({ ...parsed, date: dates.get(parsed.index) ?? '' });
  }
  return result;
}

export async function createStash(rootDir: string, stream: string, name: string, log: LogFn): Promise<boolean> {
  const repo = repoPath(rootDir, stream);
  const branch = await git.currentBranch(repo);
  const { stdout } = await run('git', ['status', '--porcelain'], repo, true);
  if (!stdout.trim()) { log('[INFO] 没有改动可暂存'); return false; }
  const msg = stashMsg(stream, branch, name);
  if (!await git.gitStashPush(repo, msg)) { log('[ERROR] Stash 失败'); return false; }
  log(`[OK] 已暂存: ${name}`);
  return true;
}

export async function popStash(rootDir: string, stream: string, index: number, log: LogFn): Promise<boolean> {
  const repo = repoPath(rootDir, stream);
  if (!await git.gitStashPop(repo, index)) { log(`[ERROR] Stash Pop 失败`); return false; }
  log(`[OK] 已恢复 stash@{${index}}`);
  return true;
}

export async function dropStash(rootDir: string, stream: string, index: number, log: LogFn): Promise<boolean> {
  const repo = repoPath(rootDir, stream);
  if (!await git.gitStashDrop(repo, index)) { log('[ERROR] Stash Drop 失败'); return false; }
  log(`[OK] 已删除 stash@{${index}}`);
  return true;
}

export async function getSnapshots(rootDir: string, stream: string) {
  const repo = repoPath(rootDir, stream);
  const branch = await git.currentBranch(repo);
  return git.gitLog(repo, branch);
}

// -------------------------------------------------------
// 状态查询
// -------------------------------------------------------

export async function getStreamStatus(rootDir: string, stream: string) {
  const repo = repoPath(rootDir, stream);
  const gitInited = fs.existsSync(path.join(repo, '.git'));
  const sourceJunc = fs.existsSync(path.join(repo, 'Source'));
  const branch = gitInited ? await git.currentBranch(repo) : '';
  const branches = gitInited ? await git.listBranches(repo) : [];
  const pendingSubmit = fs.existsSync(path.join(rootDir, '.p4git_pending.yaml'));
  return { gitInited, junctionOk: sourceJunc, branch, branches, pendingSubmit };
}

// -------------------------------------------------------
// Pending State
// -------------------------------------------------------

interface PendingState {
  stream: string;
  featureBranch: string;
  baseBranch: string;
  changelist: number;
  candidateFiles: string[];
}

const PENDING_FILE = '.p4git_pending.yaml';

function savePendingState(rootDir: string, state: PendingState) {
  const yaml = require('js-yaml');
  fs.writeFileSync(path.join(rootDir, PENDING_FILE), yaml.dump(state), 'utf-8');
}

function loadPendingState(rootDir: string): PendingState | null {
  const p = path.join(rootDir, PENDING_FILE);
  if (!fs.existsSync(p)) return null;
  const yaml = require('js-yaml');
  return yaml.load(fs.readFileSync(p, 'utf-8')) as PendingState;
}

function deletePendingState(rootDir: string) {
  const p = path.join(rootDir, PENDING_FILE);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// -------------------------------------------------------
// 工具函数
// -------------------------------------------------------

function writeGitIgnore(repo: string) {
  fs.writeFileSync(path.join(repo, '.gitignore'),
    '.vs/\nBinaries/\nIntermediate/\nSaved/\nDerivedDataCache/\n*.VC.db\n*.VC.opendb\n*.suo\n*.opensdf\n*.user\n');
}

function writeGitAttributes(repo: string) {
  fs.writeFileSync(path.join(repo, '.gitattributes'),
    '* text=auto eol=lf\n*.lua text eol=lf\n*.cpp text eol=lf\n*.h text eol=lf\n*.cs text eol=lf\n');
}

async function ensureJunction(repo: string, linkRel: string, target: string, log: LogFn) {
  const linkPath = path.join(repo, linkRel);
  if (!fs.existsSync(target)) { log(`[WARN] Junction 目标不存在，跳过: ${target}`); return; }
  if (fs.existsSync(linkPath)) { log(`[OK] Junction 已存在: ${linkRel}`); return; }
  await run('cmd', ['/c', `mklink /J "${linkPath}" "${target}"`], undefined, true);
  log(`[OK] Junction 已创建: ${linkRel}`);
}
