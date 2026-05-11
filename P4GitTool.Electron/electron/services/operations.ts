import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { loadConfig, repoPath, p4Root, getStream } from './config';
import * as git from './git';
import * as p4 from './p4';
import { run } from './runner';
import { parseUnifiedDiff, buildHunkReversePatch, buildLineReversePatch, DiffFile } from './diff';
import { getQueue } from './queue';

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
      const initRes = await run('git', ['init', '-b', 'mirror/p4'], repo, true);
      log(`[INFO] git init: ${initRes.code === 0 ? 'OK' : initRes.stderr}`);
      await run('git', ['config', 'user.email', 'p4git@local'], repo, true);
      await run('git', ['config', 'user.name', 'P4Git Tool'], repo, true);
      await run('git', ['config', 'core.quotepath', 'false'], repo, true);
      await run('git', ['config', 'core.symlinks', 'false'], repo, true);
      await run('git', ['config', 'i18n.logOutputEncoding', 'utf-8'], repo, true);
      await run('git', ['config', 'i18n.commitEncoding', 'utf-8'], repo, true);
      writeGitIgnore(repo);
      writeGitAttributes(repo);
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
): Promise<{ ok: boolean; changelist?: number; reason?: string }> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return { ok: false, reason: 'stream-not-found' }; }

  // 先 checkAndUpdate
  const status = await checkAndUpdate(rootDir, stream, log);
  if (status === 'outdated') {
    log('[ERROR] 存在过期文件，请先 P4 Sync');
    return { ok: false, reason: 'outdated' };
  }
  if (status !== 'ready') {
    return { ok: false, reason: 'error' };
  }

  const candidates = await buildCandidates(rootDir, stream);
  if (candidates.length === 0) {
    log('[INFO] 无可提交文件');
    return { ok: false, reason: 'no-changes' };
  }

  // p4 reconcile
  log(`[INFO] 正在 reconcile ${candidates.length} 个文件...`);
  if (!await p4.p4Reconcile(cfg, stream, candidates)) {
    log('[ERROR] p4 reconcile 失败'); return { ok: false, reason: 'reconcile-failed' };
  }

  // 创建 Changelist
  const opened = await p4.p4GetOpenedFiles(cfg, stream);
  if (opened.length === 0) {
    log('[INFO] reconcile 后无 opened 文件，可能没有实际改动');
    return { ok: false, reason: 'no-opened-files' };
  }

  const description = `[P4Git] ${stream} ${new Date().toISOString().slice(0, 16)}`;
  const cl = await p4.p4CreateChangelist(cfg, stream, description, opened);
  if (cl < 0) {
    log('[ERROR] 创建 Changelist 失败'); return { ok: false, reason: 'create-cl-failed' };
  }

  log(`[OK] Changelist ${cl} 已创建（包含 ${opened.length} 个文件），正在打开 P4V...`);
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
  const commitMsg = `submit: ${stream} ${new Date().toISOString()}`;
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

export interface ChangedFile {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | '?';
}

/**
 * 改动文件 = 工作区相对 HEAD 的未提交改动。
 * 提交快照后 HEAD 更新，文件列表自动清空。
 * mirror/p4 只在 checkAndUpdate 时用于检查过期文件。
 */
export async function getChangedFiles(
  rootDir: string, stream: string
): Promise<ChangedFile[]> {
  const repo = repoPath(rootDir, stream);

  // 1. HEAD 到工作区的未提交差异（含暂存与未暂存）
  const { stdout: uncommittedOut } = await run(
    'git', ['diff', '--name-status', 'HEAD'], repo, true
  );

  // 2. 新文件还未被 git 跟踪
  const { stdout: untrackedOut } = await run(
    'git', ['ls-files', '--others', '--exclude-standard'], repo, true
  );

  const map = new Map<string, ChangedFile>();

  const consume = (out: string) => {
    for (const line of out.split('\n').filter(Boolean)) {
      const parts = line.split(/\t+/);
      const code = parts[0]?.[0] ?? '?';
      const p = parts[parts.length - 1] ?? '';
      if (!p) continue;
      const status = (['M', 'A', 'D', 'R'].includes(code) ? code : '?') as ChangedFile['status'];
      map.set(p, { path: p, status });
    }
  };

  consume(uncommittedOut);

  for (const p of untrackedOut.split('\n').filter(Boolean)) {
    if (!map.has(p)) map.set(p, { path: p, status: 'A' });
  }

  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
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
  const hasGitDir = fs.existsSync(path.join(repo, '.git'));
  const sourceJunc = fs.existsSync(path.join(repo, 'Source'));

  const gitInited = hasGitDir && await git.branchExists(repo, stream);
  const branch = hasGitDir ? await git.currentBranch(repo) : '';
  const branches = hasGitDir ? await git.listBranches(repo) : [];
  const pendingSubmit = fs.existsSync(path.join(rootDir, '.p4git_pending.yaml'));

  // 当前 HEAD 的 hash，用于时间线高亮当前节点
  let headHash = '';
  if (hasGitDir) {
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], repo, true);
    headHash = stdout.trim();
  }

  // 是否处于 detached HEAD（查看历史节点模式）
  // git branch --show-current 在 detached HEAD 下返回空字符串
  const isDetached = hasGitDir && branch === '';

  return { gitInited, junctionOk: sourceJunc, branch, branches, pendingSubmit, headHash, isDetached };
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
  if (!fs.existsSync(target)) {
    log(`[WARN] Junction 目标不存在，跳过: ${target}`);
    return;
  }
  if (fs.existsSync(linkPath)) {
    log(`[OK] Junction 已存在: ${linkRel}`);
    return;
  }
  try {
    // 用 Node.js 原生 API 创建 Junction，不依赖 cmd.exe
    fs.symlinkSync(target, linkPath, 'junction');
    log(`[OK] Junction 已创建: ${linkRel} -> ${target}`);
  } catch (e: any) {
    log(`[ERROR] Junction 创建失败: ${linkRel} -> ${target}: ${e.message}`);
  }
}

// -------------------------------------------------------
// 快照操作
// -------------------------------------------------------

/**
 * 用户手动触发的快照：git add -A + git commit -m "<message>"
 */
export async function commitSnapshot(
  rootDir: string, stream: string, message: string, log: LogFn
): Promise<boolean> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return false; }

  const repo = repoPath(rootDir, stream);
  const queue = getQueue(repo);

  return queue.enqueue(async () => {
    if (await git.hasMergeConflict(repo)) {
      log('[ERROR] 工作区存在合并冲突，请先解决'); return false;
    }

    await run('git', ['add', '-A'], repo, true);
    const { stdout: st } = await run('git', ['status', '--porcelain'], repo, true);
    if (!st.trim()) {
      log('[INFO] 无改动可快照'); return false;
    }

    if (!await git.gitCommit(repo, message)) {
      log('[ERROR] git commit 失败'); return false;
    }
    log(`[OK] 快照已创建：${message}`);
    return true;
  });
}

export type SnapshotKind = 'sync' | 'sync-protect' | 'manual' | 'submit' | 'other';

export interface SnapshotEntry {
  hash: string;
  parentHash: string;
  date: string;    // ISO
  message: string;
  kind: SnapshotKind;
  fileCount: number;
}

function detectKind(msg: string): SnapshotKind {
  if (/^update: 同步 ?P4/i.test(msg) || /^sync:/i.test(msg)) return 'sync';
  if (/^sync 前自动保护/.test(msg) || /^sync-protect:/i.test(msg)) return 'sync-protect';
  if (/^submit:/i.test(msg)) return 'submit';
  if (/^build:/i.test(msg)) return 'other';
  return 'manual';
}

/**
 * 列出 stream 分支的快照（含节点类型）。最新的在数组末尾。
 * 始终用 stream 分支名而不是 HEAD，确保 detached HEAD 时也能看到完整历史。
 */
export async function listSnapshots(
  rootDir: string, stream: string, limit = 100
): Promise<SnapshotEntry[]> {
  const repo = repoPath(rootDir, stream);
  // 用 stream 分支名，不用 HEAD
  const ref = await git.branchExists(repo, stream) ? stream : 'HEAD';
  const { stdout } = await run(
    'git',
    ['log', `--max-count=${limit}`, '--format=%H|%P|%cI|%s', ref],
    repo,
    true
  );
  const entries: SnapshotEntry[] = [];
  for (const line of stdout.split('\n').filter(Boolean)) {
    const [hash, parents, date, ...msgParts] = line.split('|');
    const message = msgParts.join('|');
    const parent = (parents ?? '').split(' ')[0] ?? '';

    let fileCount = 0;
    if (parent) {
      const { stdout: namesOut } = await run(
        'git', ['diff', '--name-only', parent, hash], repo, true
      );
      fileCount = namesOut.split('\n').filter(Boolean).length;
    }

    entries.push({
      hash, parentHash: parent, date, message,
      kind: detectKind(message), fileCount,
    });
  }
  return entries.reverse();
}

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

// -------------------------------------------------------
// Diff 查询
// -------------------------------------------------------

/**
 * 获取指定文件相对上一个 commit（HEAD~1）的结构化 diff。
 * 和 Fork 行为一致：显示"这次改了什么"。
 * 新增文件（HEAD~1 里不存在）返回全部内容作为新增行。
 */
export async function getFileDiff(
  rootDir: string, stream: string, filepath: string
): Promise<DiffFile | null> {
  const repo = repoPath(rootDir, stream);

  // git diff HEAD -- filepath：工作区相对上一个 commit 的改动
  const { stdout } = await run(
    'git', ['diff', 'HEAD', '--', filepath], repo, true
  );
  if (stdout.trim()) {
    const files = parseUnifiedDiff(stdout);
    return files[0] ?? null;
  }

  // diff 为空：可能是新增文件（HEAD 里不存在）或文件未改动
  // 检查文件是否在 HEAD 里存在
  const { code: lsCode } = await run(
    'git', ['ls-files', '--error-unmatch', filepath], repo, true
  );

  if (lsCode !== 0) {
    // 文件不在 HEAD 里（新增文件），读取全部内容构造全绿 diff
    const absPath = path.join(repo, filepath);
    if (!fs.existsSync(absPath)) return null;
    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      return {
        oldPath: filepath,
        newPath: filepath,
        hunks: [{
          header: `@@ -0,0 +1,${lines.length} @@`,
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: lines.length,
          lines: lines.map(l => ({ type: 'add' as const, content: l })),
        }],
      };
    } catch {
      return null;
    }
  }

  // 文件在 HEAD 里存在但 diff 为空 = 文件未改动（已提交快照）
  return null;
}
