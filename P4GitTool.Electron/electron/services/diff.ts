export type DiffLineType = 'ctx' | 'add' | 'del';

export interface DiffLine {
  type: DiffLineType;
  content: string;
}

export interface DiffHunk {
  header: string;        // 原始的 @@ 行
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(text: string): DiffFile[] {
  if (!text.trim()) return [];

  const files: DiffFile[] = [];
  const lines = text.split('\n');
  let i = 0;
  let curFile: DiffFile | null = null;
  let curHunk: DiffHunk | null = null;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('diff --git ')) {
      curFile = { oldPath: '', newPath: '', hunks: [] };
      files.push(curFile);
      curHunk = null;
      i++;
      continue;
    }

    if (line.startsWith('--- a/')) {
      if (curFile) curFile.oldPath = line.slice(6);
      i++;
      continue;
    }
    if (line.startsWith('--- ')) {
      if (curFile) curFile.oldPath = line.slice(4);
      i++;
      continue;
    }

    if (line.startsWith('+++ b/')) {
      if (curFile) curFile.newPath = line.slice(6);
      i++;
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (curFile) curFile.newPath = line.slice(4);
      i++;
      continue;
    }

    const m = line.match(HUNK_RE);
    if (m && curFile) {
      curHunk = {
        header: line,
        oldStart: parseInt(m[1], 10),
        oldLines: m[2] ? parseInt(m[2], 10) : 1,
        newStart: parseInt(m[3], 10),
        newLines: m[4] ? parseInt(m[4], 10) : 1,
        lines: [],
      };
      curFile.hunks.push(curHunk);
      i++;
      continue;
    }

    if (curHunk) {
      if (line.startsWith('+')) {
        curHunk.lines.push({ type: 'add', content: line.slice(1) });
      } else if (line.startsWith('-')) {
        curHunk.lines.push({ type: 'del', content: line.slice(1) });
      } else if (line.startsWith(' ')) {
        curHunk.lines.push({ type: 'ctx', content: line.slice(1) });
      }
      // 其他行（如 \ No newline at end of file）忽略
    }
    i++;
  }

  return files;
}

function hunkHeader(oldStart: number, oldLines: number, newStart: number, newLines: number): string {
  return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
}

/**
 * 构造某个 hunk 的反向 patch。
 * 用法：git apply --reverse 该 patch，即可撤销该 hunk 的改动。
 */
export function buildHunkReversePatch(file: DiffFile, hunk: DiffHunk): string {
  const header = `--- a/${file.oldPath}\n+++ b/${file.newPath}\n`;
  const hunkLines = hunk.lines.map(l => {
    const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
    return sign + l.content;
  });
  const hunkHdr = hunkHeader(hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines);
  return header + hunkHdr + '\n' + hunkLines.join('\n') + '\n';
}

/**
 * 构造只撤销某 hunk 中单行改动的反向 patch。
 * lineIndex 指向 hunk.lines 中的一个 add 或 del 行。
 * 其他 add/del 行被当作 ctx 保留（不反向应用它们），只反向应用这一行。
 */
export function buildLineReversePatch(file: DiffFile, hunk: DiffHunk, lineIndex: number): string {
  const target = hunk.lines[lineIndex];
  if (!target || target.type === 'ctx') {
    throw new Error('目标行必须是新增或删除行');
  }

  // 构造新 lines：只保留目标行的增删语义，其他 add/del 根据情况处理
  // 对于撤销一个 add 行：在原文件里不存在这行，在新文件里存在。反向 patch 要把这行删掉。
  //   新的 hunk：其他 add 行仍然算新文件的内容（作为 ctx 保留），其他 del 行忽略（不反向它们），目标 add 行作为 del。
  // 对于撤销一个 del 行：原文件有，新文件没有。反向 patch 要把这行加回去。
  //   新的 hunk：目标 del 行作为 add，其他 del 行忽略，其他 add 行作为 ctx。

  const newLines: DiffLine[] = [];
  let oldLines = 0;
  let newCount = 0;

  for (let i = 0; i < hunk.lines.length; i++) {
    const l = hunk.lines[i];
    if (i === lineIndex) {
      // 目标行：原本 add 的反向是 del，原本 del 的反向是 add
      if (l.type === 'add') {
        newLines.push({ type: 'del', content: l.content });
        oldLines++;
      } else {
        newLines.push({ type: 'add', content: l.content });
        newCount++;
      }
    } else if (l.type === 'ctx') {
      newLines.push(l);
      oldLines++;
      newCount++;
    } else if (l.type === 'add') {
      // 非目标的 add：在新文件里存在，作为 ctx 保留（这样 patch 能在新文件上匹配）
      newLines.push({ type: 'ctx', content: l.content });
      oldLines++;
      newCount++;
    }
    // 非目标的 del：在新文件里不存在，忽略
  }

  const header = `--- a/${file.oldPath}\n+++ b/${file.newPath}\n`;
  const hunkHdr = hunkHeader(hunk.newStart, oldLines, hunk.newStart, newCount);
  const body = newLines.map(l => {
    const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
    return sign + l.content;
  }).join('\n');

  return header + hunkHdr + '\n' + body + '\n';
}
