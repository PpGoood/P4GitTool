import path from 'path';
import { loadConfig, repoPath, getStream } from './config';
import * as git from './git';
import * as p4 from './p4';
import { run } from './runner';
import { LogFn, gitTag } from './internal';

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

  // 一次性取 P4 相关 tag 的 full hash 集合，避开 short hash 长度不确定
  const { stdout: tagOut } = await run(
    'git',
    ['for-each-ref', '--format=%(objectname) %(refname:short)',
      'refs/tags/p4-submit-*', 'refs/tags/p4-sync-*'],
    repo, true
  );
  const p4TagHashes = new Set<string>();
  // tag 名格式：p4-submit-YYYYMMDD-HHMM / p4-sync-YYYYMMDD-HHMM，严格匹配，避免误吞
  const P4_TAG_RE = /^p4-(submit|sync)-\d{8}-\d{4}$/;
  for (const line of tagOut.split('\n').filter(Boolean)) {
    const [hash, name] = line.split(' ');
    if (hash && name && P4_TAG_RE.test(name)) p4TagHashes.add(hash);
  }

  // 一次性取 HEAD 历史（hash + commit message），在内存里找基准
  const { stdout: logOut } = await run(
    'git', ['log', '--format=%H|%s', 'HEAD'], repo, true
  );

  let baseHash = '';
  for (const line of logOut.split('\n').filter(Boolean)) {
    const idx = line.indexOf('|');
    if (idx < 0) continue;
    const hash = line.slice(0, idx);
    const msg = line.slice(idx + 1);
    if (p4TagHashes.has(hash) || /^init:/i.test(msg)) {
      baseHash = hash;
      break;
    }
  }

  if (!baseHash) {
    // 没找到基准，降级用 mirror/p4
    const files = await git.diffNameOnly(repo, 'mirror/p4', 'HEAD');
    return files.filter(f =>
      f.startsWith('Source/') || f.startsWith('Source\\') ||
      f.startsWith('Content/Script/') || f.startsWith('Content\\Script\\')
    ).map(f => path.join(p4r, f.replace(/\//g, path.sep)));
  }

  // 用找到的基准 hash 做 diff
  const files = await git.diffNameOnly(repo, baseHash, 'HEAD');
  return files.filter(f =>
    f.startsWith('Source/') || f.startsWith('Source\\') ||
    f.startsWith('Content/Script/') || f.startsWith('Content\\Script\\')
  ).map(f => path.join(p4r, f.replace(/\//g, path.sep)));
}

async function checkOutdated(
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

  const repo = repoPath(rootDir, stream);

  // 检查工作区是否干净（有未提交改动则拦截）
  if (!await git.gitCheckClean(repo)) {
    log('[ERROR] 工作区有未提交的改动，请先提交快照再提交到 P4');
    return { ok: false, reason: 'dirty-workspace' };
  }

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
    log('[INFO] 无可提交文件（git diff mirror/p4 为空）');
    return { ok: false, reason: 'no-changes' };
  }
  log(`[INFO] 候选文件 ${candidates.length} 个：${candidates.slice(0, 5).join(', ')}${candidates.length > 5 ? '...' : ''}`);

  // 先创建空 CL
  const description = `[P4Git] ${stream} ${new Date().toISOString().slice(0, 16)}`;
  const cl = await p4.p4CreateChangelist(cfg, stream, description, []);
  if (cl < 0) {
    log('[ERROR] 创建 Changelist 失败'); return { ok: false, reason: 'create-cl-failed' };
  }
  log(`[INFO] Changelist ${cl} 已创建，正在 reconcile 候选文件...`);

  // 只 reconcile 候选文件（git diff mirror/p4 HEAD 的结果），不扫描整个目录
  if (!await p4.p4ReconcileFiles(cfg, stream, cl, candidates, log)) {
    log('[ERROR] p4 reconcile 失败'); return { ok: false, reason: 'reconcile-failed' };
  }

  // 检查 CL 里是否有文件
  const opened = await p4.p4GetOpenedFiles(cfg, stream);
  if (opened.length === 0) {
    log('[INFO] reconcile 后无 opened 文件，可能没有实际改动');
    return { ok: false, reason: 'no-opened-files' };
  }

  log(`[INFO] Changelist ${cl} 包含 ${opened.length} 个文件，正在打开 P4V...`);
  const openRes = await p4.p4OpenP4V(cfg, stream, cl);
  if (!openRes.ok) {
    log(`[ERROR] P4V 启动失败: ${openRes.error ?? 'unknown'}`);
    return { ok: false, reason: 'p4v-launch-failed' };
  }

  // P4V 已启动后再打 p4-submit tag，避免启动失败导致时间线误显绿色
  await gitTag(repo, 'p4-submit');

  return { ok: true, changelist: cl };
}
