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

export async function gitCheckout(repo: string, branch: string): Promise<boolean> {
  const { code } = await run('git', ['checkout', branch], repo, true);
  return code === 0;
}

export async function gitResetHard(repo: string): Promise<boolean> {
  const { code } = await run('git', ['reset', '--hard', 'HEAD'], repo, true);
  return code === 0;
}

export async function gitClean(repo: string): Promise<boolean> {
  const { code } = await run('git', ['clean', '-fd'], repo, true);
  return code === 0;
}

export async function gitMerge(repo: string, branch: string): Promise<{ ok: boolean; stderr: string }> {
  const { code, stderr } = await run('git', ['merge', '--no-edit', branch], repo, true);
  return { ok: code === 0, stderr };
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
 * Plumbing merge：不动工作区文件，只操作 Git 对象和引用。
 * 用 merge-tree --write-tree 做 3-way merge，无冲突时 commit-tree + update-ref。
 * 返回 { ok, conflicts, error }。
 */
export async function plumbingMerge(
  repo: string, branch: string, message: string
): Promise<{ ok: boolean; conflicts?: string[]; error?: string }> {
  const currentBr = await currentBranch(repo);
  if (!currentBr) return { ok: false, error: 'detached HEAD' };

  const headHash = await revParse(repo, 'HEAD');
  const branchHash = await revParse(repo, branch);
  if (!headHash || !branchHash) return { ok: false, error: '无法解析分支 HEAD' };

  // fast-forward: 如果 dev 是 mirror/p4 的祖先，直接移动引用
  const { code: ancestorCode } = await run(
    'git', ['merge-base', '--is-ancestor', headHash, branchHash], repo, true
  );
  if (ancestorCode === 0) {
    if (!await updateRef(repo, currentBr, branchHash)) {
      return { ok: false, error: 'update-ref 失败' };
    }
    await run('git', ['read-tree', branchHash], repo, true);
    await run('git', ['update-index', '--refresh'], repo, true);
    return { ok: true };
  }

  // 3-way merge in memory
  const { code, stdout, stderr } = await run(
    'git', ['merge-tree', '--write-tree', 'HEAD', branch], repo, true
  );

  if (code === 0) {
    // 无冲突，stdout 是 tree hash
    const treeHash = stdout.trim();
    const { stdout: commitOut } = await run(
      'git', ['commit-tree', treeHash, '-p', headHash, '-p', branchHash, '-m', message],
      repo, true
    );
    const mergeCommit = commitOut.trim();
    if (!mergeCommit) return { ok: false, error: 'commit-tree 失败' };

    if (!await updateRef(repo, currentBr, mergeCommit)) {
      return { ok: false, error: 'update-ref 失败' };
    }
    await run('git', ['read-tree', mergeCommit], repo, true);
    await run('git', ['update-index', '--refresh'], repo, true);
    return { ok: true };
  }

  // 有冲突：回退到真正的 git merge，让冲突标记写入工作区供用户解决
  const mergeResult = await run('git', ['merge', '--no-edit', branch], repo, true);
  const realConflicts = await conflictFiles(repo);
  if (realConflicts.length > 0) {
    return { ok: false, conflicts: realConflicts };
  }

  // merge 成功了（可能 merge-tree 误报）
  if (mergeResult.code === 0) {
    await run('git', ['update-index', '--refresh'], repo, true);
    return { ok: true };
  }

  return { ok: false, error: mergeResult.stderr || 'merge 失败' };
}

export async function applyReversePatch(repo: string, patch: string): Promise<boolean> {
  const { code, stderr } = await run('git', ['apply', '--reverse', '--whitespace=nowarn', '-'], repo, true, patch);
  if (code !== 0) {
    console.error(`[git apply --reverse] failed:\npatch:\n${patch}\nstderr:\n${stderr}`);
  }
  return code === 0;
}

/**
 * 从指定 ref 还原单个文件到工作区。
 */
export async function gitCheckoutFile(repo: string, ref: string, filepath: string): Promise<boolean> {
  const { code } = await run('git', ['checkout', ref, '--', filepath], repo, true);
  return code === 0;
}
