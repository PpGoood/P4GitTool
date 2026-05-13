import { loadConfig, repoPath, getStream } from './config';
import * as git from './git';
import { run } from './runner';
import { getQueue } from './queue';
import { LogFn } from './internal';

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

// -------------------------------------------------------
// 时间线
// -------------------------------------------------------

export type SnapshotKind = 'sync' | 'sync-protect' | 'manual' | 'submit' | 'other';

export interface SnapshotEntry {
  hash: string;
  parentHash: string;
  date: string;    // ISO
  message: string;
  kind: SnapshotKind;
  fileCount: number;
}

function detectKind(msg: string, tags: string[]): SnapshotKind {
  // 优先用 tag 判断
  if (tags.some(t => t.startsWith('p4-submit-'))) return 'submit';
  if (tags.some(t => t.startsWith('p4-sync-'))) return 'sync';
  if (tags.some(t => t.startsWith('p4-sync-protect-'))) return 'sync-protect';
  // 降级用 commit message
  if (/^sync-protect:/i.test(msg)) return 'sync-protect';
  if (/^build:/i.test(msg)) return 'other';
  if (/^init:/i.test(msg)) return 'sync';
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
  const ref = await git.branchExists(repo, stream) ? stream : 'HEAD';

  // 一次性取 commit 元信息 + 每个 commit 的文件列表，避免 N+1 次 git diff
  // 用 START 标记分隔每个 commit 的元信息与文件名块
  const COMMIT_SEP = '\x1e<P4GIT-COMMIT>\x1e';
  const { stdout } = await run(
    'git',
    ['log', `--max-count=${limit}`, `--format=${COMMIT_SEP}%H|%P|%cI|%s`, '--name-only', ref],
    repo,
    true
  );

  // 一次性读取所有 tag，用 full hash 建索引，避免 short hash 长度不确定
  const { stdout: tagOut } = await run(
    'git', ['for-each-ref', '--format=%(objectname) %(refname:short)', 'refs/tags/'], repo, true
  );
  const tagMap = new Map<string, string[]>();
  for (const line of tagOut.split('\n').filter(Boolean)) {
    const [fullHash, tagName] = line.split(' ');
    if (!fullHash || !tagName) continue;
    if (!tagMap.has(fullHash)) tagMap.set(fullHash, []);
    tagMap.get(fullHash)!.push(tagName);
  }

  const entries: SnapshotEntry[] = [];
  // 按 COMMIT_SEP 切，每块第一行是元信息，剩余非空行是文件名
  for (const block of stdout.split(COMMIT_SEP)) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    const head = lines[0] ?? '';
    const [hash, parents, date, ...msgParts] = head.split('|');
    if (!hash) continue;
    const message = msgParts.join('|');
    const parent = (parents ?? '').split(' ')[0] ?? '';

    // root commit（无 parent）fileCount 记 0，与原行为一致
    let fileCount = 0;
    if (parent) {
      fileCount = lines.slice(1).filter(l => l.trim()).length;
    }

    const tags = tagMap.get(hash) ?? [];

    entries.push({
      hash, parentHash: parent, date, message,
      kind: detectKind(message, tags), fileCount,
    });
  }
  return entries.reverse();
}
