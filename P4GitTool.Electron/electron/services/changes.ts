import path from 'path';
import fs from 'fs';
import { repoPath } from './config';
import * as git from './git';
import { run } from './runner';
import { parseUnifiedDiff, DiffFile } from './diff';

// -------------------------------------------------------
// 改动文件 / 提交
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
