import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
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

// 临时保留，让编译通过，Task 9-11 会重写这些调用点
async function mergeForward(
  _repo: string, _from: string, _base: string, _origin: string,
  _log: LogFn, _onConflict?: () => Promise<boolean>
): Promise<boolean> { return true; }

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
  log: LogFn
): Promise<boolean> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return false; }

  const repo = repoPath(rootDir, stream);

  if (!await p4.p4Login(cfg)) { log('[ERROR] P4 登录失败'); return false; }

  // Sync 前保护：若工作区有未提交改动，先 commit 一个快照
  const dirty = !(await git.gitCheckClean(repo));
  if (dirty) {
    log('[INFO] 检测到未提交改动，自动创建 Sync 前保护快照...');
    await run('git', ['add', '-A'], repo, true);
    if (!await git.gitCommit(repo, `sync 前自动保护 ${new Date().toISOString()}`)) {
      log('[ERROR] Sync 前保护提交失败'); return false;
    }
    log('[OK] Sync 前保护快照已创建');
  }

  log(`[INFO] 正在从 P4 同步代码 (范围: ${scope}, 模式: ${mode})...`);
  if (!await p4.p4Sync(cfg, stream, scopePaths(scope), mode === 'force', log)) return false;

  // 更新 mirror/p4（plumbing，不切换分支）
  const commitMsg = `update: 同步 P4 ${stream} ${scope} 代码`;
  if (!await snapshotToMirror(repo, scope, commitMsg, log)) return false;

  // 合并 mirror/p4 -> 当前分支（stream 名）
  const curBranch = await git.currentBranch(repo);
  log(`[INFO] 正在合并 mirror/p4 → ${curBranch}...`);
  if (!await git.gitMerge(repo, 'mirror/p4')) {
    log('[ERROR] 合并有冲突，请在 Fork 或命令行中手动解决');
    return false;
  }

  // 收尾：对齐 P4 have 记录
  if (!await p4.p4SyncKeep(cfg, stream)) {
    log('[WARN] p4 sync -k 失败，have 记录可能不一致');
  }

  log(`[OK] Pull 完成`);
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
  rootDir: string, stream: string, log: LogFn
): Promise<'ready' | 'outdated' | 'error'> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return 'error'; }

  const repo = repoPath(rootDir, stream);

  if (!await p4.p4Login(cfg)) { log('[ERROR] P4 登录失败'); return 'error'; }

  // 对齐 have 记录，消除假改动
  log('[INFO] 对齐 P4 have 记录...');
  await p4.p4SyncKeep(cfg, stream);

  // 检查候选文件是否有过期
  const candidates = await buildCandidates(rootDir, stream);
  if (candidates.length === 0) {
    log('[INFO] 无改动文件');
    return 'ready';
  }

  log(`[INFO] 检查 ${candidates.length} 个候选文件的版本...`);
  const outdated = await checkOutdated(rootDir, stream, candidates);
  if (outdated.length > 0) {
    log(`[WARN] 发现 ${outdated.length} 个过期文件，请先执行 P4 Sync 更新`);
    return 'outdated';
  }

  log('[OK] 所有候选文件均为最新');
  return 'ready';
}

// -------------------------------------------------------
// Submit to P4V
// -------------------------------------------------------

export async function submitPrepare(
  rootDir: string, stream: string, log: LogFn
): Promise<{ ok: boolean; changelist?: number }> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return { ok: false }; }

  // 先 checkAndUpdate
  const status = await checkAndUpdate(rootDir, stream, log);
  if (status !== 'ready') {
    log(`[ERROR] 未通过检查：${status}`);
    return { ok: false };
  }

  const candidates = await buildCandidates(rootDir, stream);
  if (candidates.length === 0) {
    log('[INFO] 无可提交文件');
    return { ok: false };
  }

  // p4 reconcile
  log(`[INFO] 正在 reconcile ${candidates.length} 个文件...`);
  if (!await p4.p4Reconcile(cfg, stream, candidates)) {
    log('[ERROR] p4 reconcile 失败'); return { ok: false };
  }

  // 创建 Changelist
  const opened = await p4.p4GetOpenedFiles(cfg, stream);
  if (opened.length === 0) {
    log('[INFO] reconcile 后无 opened 文件，可能没有实际改动');
    return { ok: false };
  }

  const description = `[P4Git] ${stream} 提交 ${new Date().toISOString().slice(0, 16)}`;
  const cl = await p4.p4CreateChangelist(cfg, stream, description, opened);
  if (cl < 0) {
    log('[ERROR] 创建 Changelist 失败'); return { ok: false };
  }

  log(`[OK] Changelist ${cl} 已创建，打开 P4V...`);
  await p4.p4OpenP4V(cfg, stream, cl);

  return { ok: true, changelist: cl };
}

// -------------------------------------------------------
// Confirm Submit
// -------------------------------------------------------

export async function confirmSubmit(
  rootDir: string, stream: string, log: LogFn
): Promise<boolean> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return false; }

  const repo = repoPath(rootDir, stream);

  log('[INFO] 用户已在 P4V 完成提交，正在同步结果...');

  // 同步刚提交的文件（拉回 P4 上的最新版本）
  if (!await p4.p4Sync(cfg, stream, ['...'], false, log)) {
    log('[ERROR] p4 sync 失败'); return false;
  }

  // 更新 mirror/p4 并 merge 到当前分支
  const commitMsg = `submit: ${stream} 提交已完成 ${new Date().toISOString()}`;
  if (!await snapshotToMirror(repo, 'all', commitMsg, log)) return false;

  if (!await git.gitMerge(repo, 'mirror/p4')) {
    log('[WARN] 合并 mirror/p4 失败，请手动检查');
  }

  // 收尾
  await p4.p4SyncKeep(cfg, stream);

  log(`[OK] 提交流程完成`);
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

// 临时保留以让前端 import 不报错，Plan 2 会删除前端引用后移除此段
export interface StashEntry { index: number; name: string; branch: string; stream: string; date: string; }
export async function listStashes(): Promise<StashEntry[]> { return []; }
export async function createStash(): Promise<boolean> { return false; }
export async function popStash(): Promise<boolean> { return false; }
export async function dropStash(): Promise<boolean> { return false; }

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
  fs.writeFileSync(path.join(rootDir, PENDING_FILE), yaml.dump(state), 'utf-8');
}

function loadPendingState(rootDir: string): PendingState | null {
  const p = path.join(rootDir, PENDING_FILE);
  if (!fs.existsSync(p)) return null;
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
