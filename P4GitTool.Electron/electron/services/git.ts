import { run } from './runner';

export async function gitCheckClean(repo: string): Promise<boolean> {
  const { stdout } = await run('git', ['status', '--porcelain'], repo, true);
  return stdout.trim() === '';
}

export async function currentBranch(repo: string): Promise<string> {
  const { stdout } = await run('git', ['branch', '--show-current'], repo, true);
  return stdout.trim();
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  const { code } = await run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repo, true);
  return code === 0;
}

export async function listBranches(repo: string): Promise<string[]> {
  const { stdout } = await run('git', ['branch', '--format=%(refname:short)'], repo, true);
  return stdout.split('\n').map(b => b.trim()).filter(Boolean);
}

export async function gitAdd(repo: string, targets: string[]) {
  await run('git', ['add', '-A', '--', ...targets], repo, true);
}

export async function gitCommit(repo: string, message: string): Promise<boolean> {
  const { code } = await run('git', ['commit', '-m', message], repo, true);
  return code === 0;
}

export async function gitStatus(repo: string): Promise<{ status: string; path: string }[]> {
  const { stdout } = await run('git', ['status', '--porcelain'], repo, true);
  return stdout.split('\n')
    .filter(Boolean)
    .map(line => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3).trim(),
    }));
}

export async function readTree(repo: string, ref: string): Promise<boolean> {
  const { code } = await run('git', ['read-tree', ref], repo, true);
  return code === 0;
}

export async function writeTree(repo: string): Promise<string> {
  const { stdout } = await run('git', ['write-tree'], repo, true);
  return stdout.trim();
}

export async function revParse(repo: string, ref: string): Promise<string> {
  const { stdout } = await run('git', ['rev-parse', ref], repo, true);
  return stdout.trim();
}

export async function commitTree(repo: string, tree: string, parent: string, message: string): Promise<string> {
  const { stdout } = await run('git', ['commit-tree', tree, '-p', parent, '-m', message], repo, true);
  return stdout.trim();
}

export async function updateRef(repo: string, ref: string, hash: string): Promise<boolean> {
  const { code } = await run('git', ['update-ref', `refs/heads/${ref}`, hash], repo, true);
  return code === 0;
}

export async function mergeTree(repo: string, dst: string, src: string): Promise<{ tree: string; hasConflict: boolean }> {
  const { code, stdout } = await run('git', ['merge-tree', '--write-tree', dst, src], repo, true);
  const tree = stdout.split('\n')[0].trim();
  return { tree, hasConflict: code !== 0 };
}

export async function mergeBase(repo: string, a: string, b: string): Promise<string> {
  const { stdout } = await run('git', ['merge-base', a, b], repo, true);
  return stdout.trim();
}

export async function gitCheckout(repo: string, branch: string): Promise<boolean> {
  const { code } = await run('git', ['checkout', branch], repo, true);
  return code === 0;
}

export async function gitMerge(repo: string, branch: string): Promise<boolean> {
  const { code } = await run('git', ['merge', '--no-edit', branch], repo, true);
  return code === 0;
}

export async function gitStashList(repo: string): Promise<string[]> {
  const { stdout } = await run('git', ['stash', 'list'], repo, true);
  return stdout.split('\n').filter(Boolean);
}

export async function gitStashPush(repo: string, message: string): Promise<boolean> {
  await run('git', ['add', '-A'], repo, true);
  const { code } = await run('git', ['stash', 'push', '-m', message], repo, true);
  return code === 0;
}

export async function gitStashPop(repo: string, index: number): Promise<boolean> {
  const { code } = await run('git', ['stash', 'pop', `stash@{${index}}`], repo, true);
  return code === 0;
}

export async function gitStashDrop(repo: string, index: number): Promise<boolean> {
  const { code } = await run('git', ['stash', 'drop', `stash@{${index}}`], repo, true);
  return code === 0;
}

export async function gitReflogDates(repo: string): Promise<Map<number, string>> {
  const { stdout } = await run('git', ['reflog', 'show', '--format=%gd|%ci', 'refs/stash'], repo, true);
  const map = new Map<number, string>();
  for (const line of stdout.split('\n').filter(Boolean)) {
    const [ref, date] = line.split('|');
    const m = ref?.match(/stash@\{(\d+)\}/);
    if (m && date) map.set(parseInt(m[1]), date.slice(0, 16));
  }
  return map;
}

export async function gitLog(repo: string, branch: string, limit = 20): Promise<{ hash: string; message: string; date: string }[]> {
  const { stdout } = await run('git', ['log', branch, `--max-count=${limit}`, '--format=%H|%s|%ci'], repo, true);
  return stdout.split('\n').filter(Boolean).map(line => {
    const [hash, message, date] = line.split('|');
    return { hash: hash ?? '', message: message ?? '', date: date?.slice(0, 16) ?? '' };
  });
}

export async function diffNameOnly(repo: string, base: string, head: string): Promise<string[]> {
  const { stdout } = await run('git', ['diff', '--name-only', '--diff-filter=ACMRD', `${base}...${head}`], repo, true);
  return stdout.split('\n').map(l => l.trim()).filter(Boolean);
}

export async function hasMergeConflict(repo: string): Promise<boolean> {
  const { stdout } = await run('git', ['diff', '--name-only', '--diff-filter=U'], repo, true);
  return stdout.trim() !== '';
}

export async function conflictFiles(repo: string): Promise<string[]> {
  const { stdout } = await run('git', ['diff', '--name-only', '--diff-filter=U'], repo, true);
  return stdout.split('\n').map(l => l.trim()).filter(Boolean);
}

/**
 * 对比某文件在工作区与指定 ref 的差异（返回 unified diff 文本）。
 */
export async function diffFile(repo: string, filepath: string, base: string): Promise<string> {
  const { stdout } = await run('git', ['diff', base, '--', filepath], repo, true);
  return stdout;
}

/**
 * 反向应用一个 patch（通过 stdin 传入），用于撤销某个 hunk / line。
 */
export async function applyReversePatch(repo: string, patch: string): Promise<boolean> {
  const { code } = await run('git', ['apply', '--reverse', '--whitespace=nowarn', '-'], repo, true, patch);
  return code === 0;
}

/**
 * 从指定 ref 还原单个文件到工作区。
 */
export async function gitCheckoutFile(repo: string, ref: string, filepath: string): Promise<boolean> {
  const { code } = await run('git', ['checkout', ref, '--', filepath], repo, true);
  return code === 0;
}
