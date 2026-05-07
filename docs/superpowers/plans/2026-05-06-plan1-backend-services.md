# P4Git Tool 重构 — 计划1：后端服务层

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 Electron 主进程的服务层，新增写操作队列、文件监听、diff 解析，修复已知 bug，删除 stash/branch 相关代码。

**Architecture:** 保持现有 Express + Node.js 架构不变。新增 `queue.ts`（串行化写操作）、`watcher.ts`（chokidar 文件监听）、`diff.ts`（diff 解析与 hunk patch 构造）。修复 `runner.ts` 支持 stdin、修复 `p4.ts` 的 `p4CreateChangelist`、修复 `operations.ts` 的 ESM import 和 `p4 sync -k` 收尾逻辑。

**Tech Stack:** Node.js, TypeScript, chokidar, js-yaml (ESM), electron

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | `electron/services/runner.ts` | 新增 stdin 参数支持 |
| 新增 | `electron/services/queue.ts` | 写操作串行化队列 |
| 新增 | `electron/services/watcher.ts` | chokidar 文件监听，SSE 推送 |
| 新增 | `electron/services/diff.ts` | diff 解析、hunk 提取、patch 构造 |
| 修改 | `electron/services/p4.ts` | 修复 p4CreateChangelist stdin 传入 |
| 修改 | `electron/services/operations.ts` | 修复 ESM import、删除 stash/branch 代码、新增 p4 sync -k、新增 discardHunk/discardFile/rollback |
| 修改 | `electron/services/config.ts` | 工作线分支名改为 stream 名（已是如此，确认即可） |
| 修改 | `vite.config.ts` | rollupOptions external 新增 chokidar |

---

## 前置准备

### Task 0: 安装依赖与准备测试框架

**Files:**
- Modify: `P4GitTool.Electron/package.json`
- Modify: `P4GitTool.Electron/vite.config.ts`

- [ ] **Step 1: 安装运行时依赖 chokidar**

工作目录：`D:/Workspaces_Git/P4GitTool/P4GitTool.Electron/`

```bash
npm install chokidar@4.0.3
```

Expected: `package.json` 新增 `"chokidar": "^4.0.3"` 到 dependencies。

- [ ] **Step 2: 安装测试依赖**

```bash
npm install --save-dev vitest@2.1.9 @types/node
```

Expected: `package.json` 新增 vitest 到 devDependencies。

- [ ] **Step 3: 在 vite.config.ts 的 external 数组中加入 chokidar**

修改 `vite.config.ts`，找到 `external: [...]` 行，添加 `'chokidar'`：

```typescript
external: ['electron', 'express', 'js-yaml', 'chokidar', 'child_process', 'fs', 'path', 'os', 'net'],
```

- [ ] **Step 4: 新增 vitest.config.ts**

Create: `P4GitTool.Electron/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['electron/services/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 5: 在 package.json 的 scripts 中新增 test 命令**

修改 `package.json`：

```json
"scripts": {
  "dev": "concurrently \"vite\" \"electron-wait-and-start\"",
  "dev:vite": "vite",
  "dev:electron": "wait-on http://localhost:5173 && cross-env NODE_ENV=development electron .",
  "build": "tsc -p tsconfig.electron.json && vite build",
  "build:electron": "tsc -p tsconfig.electron.json",
  "build:renderer": "vite build",
  "package": "npm run build && electron-builder --win nsis",
  "package:dir": "npm run build && electron-builder --win dir",
  "lint": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 6: 运行 lint 确认未引入类型错误**

```bash
npm run lint
```

Expected: 无输出，退出码 0。

- [ ] **Step 7: 提交**

```bash
git add P4GitTool.Electron/package.json P4GitTool.Electron/package-lock.json P4GitTool.Electron/vite.config.ts P4GitTool.Electron/vitest.config.ts
git commit -m "chore: add chokidar and vitest for backend refactor"
```

---

## Task 1: 扩展 runner.ts 支持 stdin

现有 `run()` 不支持 stdin 输入，导致 `p4 change -i`（必须通过 stdin 传入 spec）无法正确执行。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/runner.ts`
- Test: `P4GitTool.Electron/electron/services/runner.test.ts`

- [ ] **Step 1: 先写失败的测试**

Create: `P4GitTool.Electron/electron/services/runner.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { run } from './runner';

describe('run', () => {
  it('执行简单命令并返回 stdout', async () => {
    const result = await run('node', ['-e', 'console.log("hello")']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('支持 stdin 输入', async () => {
    const result = await run(
      'node',
      ['-e', 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(s))'],
      undefined,
      true,
      'hello from stdin'
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hello from stdin');
  });

  it('stdin 为空字符串时不挂起', async () => {
    const result = await run('node', ['-e', 'console.log("ok")'], undefined, true, '');
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd P4GitTool.Electron && npm run test
```

Expected: "支持 stdin 输入" 测试失败，因为当前 `run` 不接受第 5 个参数。

- [ ] **Step 3: 修改 runner.ts 添加 stdin 参数**

Modify: `P4GitTool.Electron/electron/services/runner.ts`

完整替换文件内容：

```typescript
import { spawn } from 'child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function run(
  cmd: string,
  args: string[],
  cwd?: string,
  silent = false,
  stdin?: string
): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: cwd ?? process.cwd(),
      shell: true,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    if (stdin !== undefined) {
      proc.stdin.write(stdin);
    }
    proc.stdin.end();
  });
}

// 流式执行，每行通过回调推送（用于 SSE 日志）
export function runStream(
  cmd: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void
): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd,
      shell: true,
      windowsHide: true,
    });

    const handleData = (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    };

    proc.stdout.on('data', handleData);
    proc.stderr.on('data', handleData);
    proc.on('close', (code) => resolve(code ?? 1));
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd P4GitTool.Electron && npm run test
```

Expected: 3 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/services/runner.ts P4GitTool.Electron/electron/services/runner.test.ts
git commit -m "feat: runner 支持 stdin 输入"
```

---

## Task 2: 写操作串行化队列 queue.ts

所有修改 git index 的写操作（add、commit、checkout、apply）必须串行执行，防止 `index.lock` 冲突。参考 git-cola 的 `_index_lock` 机制。

**Files:**
- Create: `P4GitTool.Electron/electron/services/queue.ts`
- Test: `P4GitTool.Electron/electron/services/queue.test.ts`

- [ ] **Step 1: 先写失败的测试**

Create: `P4GitTool.Electron/electron/services/queue.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { WriteQueue } from './queue';

describe('WriteQueue', () => {
  it('串行执行多个任务', async () => {
    const q = new WriteQueue();
    const order: number[] = [];

    const t1 = q.enqueue(async () => {
      await new Promise(r => setTimeout(r, 30));
      order.push(1);
      return 'a';
    });
    const t2 = q.enqueue(async () => {
      order.push(2);
      return 'b';
    });
    const t3 = q.enqueue(async () => {
      order.push(3);
      return 'c';
    });

    const results = await Promise.all([t1, t2, t3]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(order).toEqual([1, 2, 3]);
  });

  it('任务抛出异常不影响后续任务', async () => {
    const q = new WriteQueue();
    const results: string[] = [];

    const t1 = q.enqueue(async () => { throw new Error('fail1'); });
    const t2 = q.enqueue(async () => { results.push('ok2'); return 'ok2'; });

    await expect(t1).rejects.toThrow('fail1');
    await expect(t2).resolves.toBe('ok2');
    expect(results).toEqual(['ok2']);
  });

  it('返回值类型保留', async () => {
    const q = new WriteQueue();
    const result: number = await q.enqueue(async () => 42);
    expect(result).toBe(42);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd P4GitTool.Electron && npm run test -- queue
```

Expected: 全部失败，因为 queue.ts 不存在。

- [ ] **Step 3: 实现 queue.ts**

Create: `P4GitTool.Electron/electron/services/queue.ts`

```typescript
/**
 * 串行化写操作队列。
 * 防止多个 git 写命令并发执行时的 index.lock 冲突。
 */
export class WriteQueue {
  private chain: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(() => fn(), () => fn());
    this.chain = next.catch(() => {});
    return next;
  }
}

// 全局单例：每个 Git 仓库共享一个队列
const queues = new Map<string, WriteQueue>();

export function getQueue(repoPath: string): WriteQueue {
  let q = queues.get(repoPath);
  if (!q) {
    q = new WriteQueue();
    queues.set(repoPath, q);
  }
  return q;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd P4GitTool.Electron && npm run test -- queue
```

Expected: 3 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/services/queue.ts P4GitTool.Electron/electron/services/queue.test.ts
git commit -m "feat: 新增写操作串行化队列"
```

---

## Task 3: diff.ts — diff 解析与 hunk patch 构造

解析 `git diff` 的 unified diff 文本为结构化数据，同时提供构造单 hunk / 单行反向 patch 的能力，供 discard 操作使用。

**Files:**
- Create: `P4GitTool.Electron/electron/services/diff.ts`
- Test: `P4GitTool.Electron/electron/services/diff.test.ts`

- [ ] **Step 1: 先写失败的测试（解析部分）**

Create: `P4GitTool.Electron/electron/services/diff.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, buildHunkReversePatch, buildLineReversePatch } from './diff';

const SAMPLE_DIFF = `diff --git a/Source/Weapon.cpp b/Source/Weapon.cpp
index 1111111..2222222 100644
--- a/Source/Weapon.cpp
+++ b/Source/Weapon.cpp
@@ -38,6 +38,8 @@ float AWeapon::CalculateDamage()
   float base = GetBaseDamage();
   float damage = base;
 
-  damage *= 1.0f;
+  damage *= multiplier;
+  multiplier = GetWeaponMultiplier();
 
   return damage;
 }
@@ -61,5 +63,6 @@ void AWeapon::OnFire()
   PlayFireAnimation();
   SpawnProjectile();
+  ApplyRecoil();
   ConsumeAmmo();
 }
`;

describe('parseUnifiedDiff', () => {
  it('解析单文件两个 hunk', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    expect(files).toHaveLength(1);

    const f = files[0];
    expect(f.oldPath).toBe('Source/Weapon.cpp');
    expect(f.newPath).toBe('Source/Weapon.cpp');
    expect(f.hunks).toHaveLength(2);

    expect(f.hunks[0].oldStart).toBe(38);
    expect(f.hunks[0].oldLines).toBe(6);
    expect(f.hunks[0].newStart).toBe(38);
    expect(f.hunks[0].newLines).toBe(8);

    expect(f.hunks[1].oldStart).toBe(61);
    expect(f.hunks[1].newStart).toBe(63);
  });

  it('hunk 包含每行的类型', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const lines = files[0].hunks[0].lines;
    expect(lines.some(l => l.type === 'del' && l.content === 'damage *= 1.0f;')).toBe(true);
    expect(lines.some(l => l.type === 'add' && l.content === 'damage *= multiplier;')).toBe(true);
    expect(lines.some(l => l.type === 'ctx' && l.content === 'float damage = base;')).toBe(true);
  });

  it('空 diff 返回空数组', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});

describe('buildHunkReversePatch', () => {
  it('构造单 hunk 反向 patch', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const patch = buildHunkReversePatch(files[0], files[0].hunks[0]);

    expect(patch).toContain('--- a/Source/Weapon.cpp');
    expect(patch).toContain('+++ b/Source/Weapon.cpp');
    expect(patch).toContain('@@ -38,');
    expect(patch).not.toContain('@@ -61,'); // 只包含第一个 hunk
  });

  it('patch 以换行结尾', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const patch = buildHunkReversePatch(files[0], files[0].hunks[0]);
    expect(patch.endsWith('\n')).toBe(true);
  });
});

describe('buildLineReversePatch', () => {
  it('撤销单个新增行，只保留该行作为 - 和上下文', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const hunk = files[0].hunks[0];
    // 第二个 hunk 里的新增行 "+  ApplyRecoil();"
    const hunk2 = files[0].hunks[1];
    const addIdx = hunk2.lines.findIndex(l => l.type === 'add');
    const patch = buildLineReversePatch(files[0], hunk2, addIdx);

    expect(patch).toContain('--- a/Source/Weapon.cpp');
    expect(patch).toContain('+++ b/Source/Weapon.cpp');
    // 反向：原本是 add，反向后应作为 - 出现
    expect(patch).toMatch(/^-\s*ApplyRecoil\(\);$/m);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd P4GitTool.Electron && npm run test -- diff
```

Expected: 全部失败，diff.ts 不存在。

- [ ] **Step 3: 实现 diff.ts**

Create: `P4GitTool.Electron/electron/services/diff.ts`

```typescript
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd P4GitTool.Electron && npm run test -- diff
```

Expected: 6 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/services/diff.ts P4GitTool.Electron/electron/services/diff.test.ts
git commit -m "feat: 新增 diff 解析与 hunk 反向 patch 构造"
```

---

## Task 4: 修复 p4CreateChangelist

现有代码构造了 spec 字符串但没有传给 `p4 change -i`（stdin）。利用 Task 1 新增的 stdin 支持修复。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/p4.ts:120-136`

- [ ] **Step 1: 先写失败的测试（集成层面，使用 mock runner）**

Create: `P4GitTool.Electron/electron/services/p4.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 先 mock 再 import
vi.mock('./runner', () => ({
  run: vi.fn(),
}));

import * as runner from './runner';
import { p4CreateChangelist } from './p4';
import type { P4GitConfig } from './config';

const cfg: P4GitConfig = {
  p4_port: 'ssl:server:1666',
  p4_user: 'alice',
  streams: [{ name: 'dev', client: 'alice_dev', root: 'D:/P4/dev' }],
};

describe('p4CreateChangelist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('通过 stdin 传入 spec 并解析 Changelist 号', async () => {
    (runner.run as any).mockResolvedValue({
      code: 0,
      stdout: 'Change 88502 created with 3 open file(s).\n',
      stderr: '',
    });

    const cl = await p4CreateChangelist(cfg, 'dev', '测试提交', ['//depot/a.cpp', '//depot/b.h']);

    expect(cl).toBe(88502);

    const call = (runner.run as any).mock.calls[0];
    const [cmd, args, , silent, stdin] = call;
    expect(cmd).toBe('p4');
    expect(args).toContain('change');
    expect(args).toContain('-i');
    expect(stdin).toBeDefined();
    expect(stdin).toContain('Description:');
    expect(stdin).toContain('测试提交');
    expect(stdin).toContain('//depot/a.cpp');
    expect(stdin).toContain('//depot/b.h');
    expect(stdin).toContain('alice_dev');
    expect(stdin).toContain('alice');
  });

  it('未找到 stream 返回 -1', async () => {
    const cl = await p4CreateChangelist(cfg, 'nonexistent', 'desc', []);
    expect(cl).toBe(-1);
  });

  it('p4 返回未包含 Change 号时返回 -1', async () => {
    (runner.run as any).mockResolvedValue({
      code: 1, stdout: 'error', stderr: 'spec invalid',
    });
    const cl = await p4CreateChangelist(cfg, 'dev', 'desc', []);
    expect(cl).toBe(-1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd P4GitTool.Electron && npm run test -- p4
```

Expected: "通过 stdin 传入 spec" 失败，因为当前实现未使用 stdin。

- [ ] **Step 3: 修复 p4CreateChangelist**

Modify: `P4GitTool.Electron/electron/services/p4.ts`

找到 `p4CreateChangelist` 函数（约 120-136 行），替换为：

```typescript
export async function p4CreateChangelist(
  cfg: P4GitConfig,
  stream: string,
  description: string,
  files: string[]
): Promise<number> {
  const sc = getStream(cfg, stream);
  if (!sc) return -1;
  const cwd = sc.root + '/ProjectX';

  // 描述中的换行需要加 tab 缩进，这是 p4 spec 格式要求
  const descLines = description.split('\n').map(l => '\t' + l).join('\n');
  const fileLines = files.map(f => `\t${f}`).join('\n');
  const spec =
    `Change: new\n` +
    `Client: ${sc.client}\n` +
    `User: ${cfg.p4_user}\n` +
    `Status: new\n` +
    `Description:\n${descLines}\n` +
    (files.length > 0 ? `Files:\n${fileLines}\n` : '');

  const { stdout } = await run(
    'p4',
    [...p4Args(cfg), '-c', sc.client, 'change', '-i'],
    cwd,
    true,
    spec
  );
  const m = stdout.match(/Change (\d+) created/);
  return m ? parseInt(m[1], 10) : -1;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd P4GitTool.Electron && npm run test -- p4
```

Expected: 3 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/services/p4.ts P4GitTool.Electron/electron/services/p4.test.ts
git commit -m "fix: p4CreateChangelist 通过 stdin 传入 spec"
```

---

## Task 5: p4.ts 新增 p4SyncKeep（p4 sync -k）

对齐 have 记录而不实际下载文件，是整个工具防止假改动的关键收尾动作。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/p4.ts`（追加函数）
- Modify: `P4GitTool.Electron/electron/services/p4.test.ts`（追加用例）

- [ ] **Step 1: 追加测试用例到 p4.test.ts**

在 `p4.test.ts` 文件末尾追加：

```typescript
import { p4SyncKeep } from './p4';

describe('p4SyncKeep', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('使用 -k flag 对所有配置路径调用 p4 sync', async () => {
    (runner.run as any).mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const ok = await p4SyncKeep(cfg, 'dev');
    expect(ok).toBe(true);

    const call = (runner.run as any).mock.calls[0];
    const [cmd, args] = call;
    expect(cmd).toBe('p4');
    expect(args).toContain('sync');
    expect(args).toContain('-k');
  });

  it('stream 未配置返回 false', async () => {
    const ok = await p4SyncKeep(cfg, 'nope');
    expect(ok).toBe(false);
  });

  it('p4 失败返回 false', async () => {
    (runner.run as any).mockResolvedValue({ code: 1, stdout: '', stderr: 'fail' });
    const ok = await p4SyncKeep(cfg, 'dev');
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd P4GitTool.Electron && npm run test -- p4
```

Expected: 3 个新测试失败，因为 `p4SyncKeep` 不存在。

- [ ] **Step 3: 在 p4.ts 追加 p4SyncKeep**

在 `p4.ts` 文件末尾追加：

```typescript
/**
 * p4 sync -k：只更新 have 记录，不下载文件。
 * 用于在 git checkout / merge / apply 等改变工作区文件内容之后，对齐 P4 的 have 表，
 * 避免 p4 reconcile 时产生大量假改动。
 */
export async function p4SyncKeep(
  cfg: P4GitConfig,
  stream: string
): Promise<boolean> {
  const sc = getStream(cfg, stream);
  if (!sc) return false;
  const cwd = sc.root + '/ProjectX';
  const { code } = await run(
    'p4',
    [...p4Args(cfg), '-c', sc.client, 'sync', '-k', '...'],
    cwd,
    true
  );
  return code === 0;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd P4GitTool.Electron && npm run test -- p4
```

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/services/p4.ts P4GitTool.Electron/electron/services/p4.test.ts
git commit -m "feat: 新增 p4SyncKeep 对齐 have 记录"
```

---

## Task 6: 文件监听 watcher.ts

使用 chokidar 监听每个 Git 仓库的 Junction 目录，文件变化后防抖 500ms 发出 `files-changed` 事件。不做自动 commit，仅用于前端刷新文件列表 UI。

**Files:**
- Create: `P4GitTool.Electron/electron/services/watcher.ts`
- Test: `P4GitTool.Electron/electron/services/watcher.test.ts`

- [ ] **Step 1: 先写失败的测试**

Create: `P4GitTool.Electron/electron/services/watcher.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WorkspaceWatcher } from './watcher';

describe('WorkspaceWatcher', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4git-watcher-'));
    fs.writeFileSync(path.join(tmpDir, 'initial.txt'), 'x');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('文件变化后触发事件（防抖合并）', async () => {
    const w = new WorkspaceWatcher({ debounceMs: 100 });
    const events: string[] = [];
    w.on('changed', (streamName) => events.push(streamName));

    await w.watch('dev', tmpDir);
    await new Promise(r => setTimeout(r, 100)); // 等待 ready

    // 快速写三次
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), '1');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), '2');
    fs.writeFileSync(path.join(tmpDir, 'c.txt'), '3');

    await new Promise(r => setTimeout(r, 300));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every(e => e === 'dev')).toBe(true);

    await w.close();
  });

  it('忽略 .git 目录的变化', async () => {
    const gitDir = path.join(tmpDir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });

    const w = new WorkspaceWatcher({ debounceMs: 100 });
    const events: string[] = [];
    w.on('changed', (s) => events.push(s));

    await w.watch('dev', tmpDir);
    await new Promise(r => setTimeout(r, 100));

    fs.writeFileSync(path.join(gitDir, 'index.lock'), '');
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref');

    await new Promise(r => setTimeout(r, 300));
    expect(events.length).toBe(0);

    await w.close();
  });

  it('unwatch 后停止接收该 stream 的事件', async () => {
    const w = new WorkspaceWatcher({ debounceMs: 100 });
    const events: string[] = [];
    w.on('changed', (s) => events.push(s));

    await w.watch('dev', tmpDir);
    await new Promise(r => setTimeout(r, 100));

    await w.unwatch('dev');

    fs.writeFileSync(path.join(tmpDir, 'x.txt'), 'y');
    await new Promise(r => setTimeout(r, 300));

    expect(events).toEqual([]);

    await w.close();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd P4GitTool.Electron && npm run test -- watcher
```

Expected: 全部失败，watcher.ts 不存在。

- [ ] **Step 3: 实现 watcher.ts**

Create: `P4GitTool.Electron/electron/services/watcher.ts`

```typescript
import chokidar, { FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';

export interface WatcherOptions {
  debounceMs?: number;
}

/**
 * 监听多个 Git 仓库（对应多个 P4 stream）的文件变化。
 * 文件变化后防抖合并，发出 'changed' 事件（参数为 stream 名）。
 * 不做自动 commit，仅供前端刷新 UI。
 */
export class WorkspaceWatcher extends EventEmitter {
  private watchers = new Map<string, FSWatcher>();
  private timers = new Map<string, NodeJS.Timeout>();
  private debounceMs: number;

  constructor(opts: WatcherOptions = {}) {
    super();
    this.debounceMs = opts.debounceMs ?? 500;
  }

  async watch(streamName: string, repoPath: string): Promise<void> {
    await this.unwatch(streamName);

    const w = chokidar.watch(repoPath, {
      ignored: (p: string) => {
        const norm = p.replace(/\\/g, '/');
        return (
          /\/\.git(\/|$)/.test(norm) ||
          /\/Binaries(\/|$)/.test(norm) ||
          /\/Intermediate(\/|$)/.test(norm) ||
          /\/Saved(\/|$)/.test(norm) ||
          /\.lock$/.test(norm)
        );
      },
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    w.on('all', () => this.schedule(streamName));

    // 等待 ready
    await new Promise<void>((resolve) => w.once('ready', () => resolve()));
    this.watchers.set(streamName, w);
  }

  async unwatch(streamName: string): Promise<void> {
    const w = this.watchers.get(streamName);
    if (w) {
      await w.close();
      this.watchers.delete(streamName);
    }
    const t = this.timers.get(streamName);
    if (t) {
      clearTimeout(t);
      this.timers.delete(streamName);
    }
  }

  async close(): Promise<void> {
    for (const [name] of this.watchers) await this.unwatch(name);
  }

  private schedule(streamName: string) {
    const prev = this.timers.get(streamName);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.timers.delete(streamName);
      this.emit('changed', streamName);
    }, this.debounceMs);
    this.timers.set(streamName, t);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd P4GitTool.Electron && npm run test -- watcher
```

Expected: 3 个测试全部通过。注意：chokidar 在 Windows 上首次启动稍慢，测试已留足时间。如某次测试偶发失败，可将 `debounceMs` 和等待时间整体放大重跑。

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/services/watcher.ts P4GitTool.Electron/electron/services/watcher.test.ts
git commit -m "feat: 新增 chokidar 文件监听（仅刷新 UI）"
```

---

## Task 7: git.ts 新增 diffFile / applyReversePatch / gitCheckoutFile

在现有 git.ts 中追加三个辅助函数，供 operations.ts 使用。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/git.ts`（追加函数）
- Test: `P4GitTool.Electron/electron/services/git.test.ts`（追加用例）

- [ ] **Step 1: 新增测试文件（首次创建）**

Create: `P4GitTool.Electron/electron/services/git.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./runner', () => ({
  run: vi.fn(),
}));

import * as runner from './runner';
import { diffFile, applyReversePatch, gitCheckoutFile } from './git';

describe('diffFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('对比工作区与 mirror/p4 返回 unified diff', async () => {
    (runner.run as any).mockResolvedValue({ code: 0, stdout: 'diff --git a/x b/x\n', stderr: '' });

    const out = await diffFile('/repo', 'Source/Weapon.cpp', 'mirror/p4');
    expect(out).toContain('diff --git');

    const args = (runner.run as any).mock.calls[0][1];
    expect(args).toContain('diff');
    expect(args).toContain('mirror/p4');
    expect(args).toContain('--');
    expect(args).toContain('Source/Weapon.cpp');
  });
});

describe('applyReversePatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('通过 stdin 传入 patch 并使用 --reverse', async () => {
    (runner.run as any).mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const ok = await applyReversePatch('/repo', 'PATCH_CONTENT');
    expect(ok).toBe(true);

    const [cmd, args, , , stdin] = (runner.run as any).mock.calls[0];
    expect(cmd).toBe('git');
    expect(args).toContain('apply');
    expect(args).toContain('--reverse');
    expect(stdin).toBe('PATCH_CONTENT');
  });

  it('apply 失败返回 false', async () => {
    (runner.run as any).mockResolvedValue({ code: 1, stdout: '', stderr: 'conflict' });
    const ok = await applyReversePatch('/repo', 'BAD');
    expect(ok).toBe(false);
  });
});

describe('gitCheckoutFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('从指定 ref 还原单个文件', async () => {
    (runner.run as any).mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const ok = await gitCheckoutFile('/repo', 'mirror/p4', 'Source/a.cpp');
    expect(ok).toBe(true);

    const args = (runner.run as any).mock.calls[0][1];
    expect(args).toEqual(['checkout', 'mirror/p4', '--', 'Source/a.cpp']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd P4GitTool.Electron && npm run test -- git
```

Expected: 全部失败，三个函数不存在。

- [ ] **Step 3: 在 git.ts 追加三个函数**

在 `git.ts` 文件末尾追加：

```typescript
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd P4GitTool.Electron && npm run test -- git
```

Expected: 4 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/services/git.ts P4GitTool.Electron/electron/services/git.test.ts
git commit -m "feat: git.ts 新增 diffFile/applyReversePatch/gitCheckoutFile"
```

---

## Task 8: operations.ts — 修复 ESM import 和删除无用代码

先做两个独立的清理：修复 `require('js-yaml')` 的 CJS 残留，删除 stash/branch/mergeBranchNoSwitch 等本次不再使用的函数。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/operations.ts`

- [ ] **Step 1: 读取当前 operations.ts 末尾部分**

Read: `P4GitTool.Electron/electron/services/operations.ts` 从第 380 行到文件末尾。

- [ ] **Step 2: 在文件顶部统一添加 import，删除内部 require**

在 `operations.ts` 顶部的 import 区块末尾加入 `import yaml from 'js-yaml';`（如已存在跳过），然后用 Grep 搜索 `require('js-yaml')`：

```bash
cd P4GitTool.Electron && grep -n "require('js-yaml')" electron/services/operations.ts
```

如有匹配，用 Edit 把 `const yaml = require('js-yaml')` 或类似代码替换为空行（因为顶部已 import）。

- [ ] **Step 3: 删除 stash 相关函数**

删除 `operations.ts` 中以下函数的完整定义：
- `stashMsg`
- `parseStashLine`
- `listStashes`
- `createStash`
- `popStash`
- `dropStash`
- interface `StashEntry`（在此文件内定义的）

删除同时确认无其他文件 import 这些符号：

```bash
cd P4GitTool.Electron && grep -rn "from './operations'" electron/ src/ | grep -iE "stash"
```

若前端暂时仍 import，本计划第 2 阶段会清理，这里保留 stash 相关的 named export 为临时空函数让 TS 编译通过：

```typescript
// 临时保留以让前端 import 不报错，Plan 2 会删除前端引用后移除此段
export interface StashEntry { index: number; name: string; branch: string; stream: string; date: string; }
export async function listStashes(): Promise<StashEntry[]> { return []; }
export async function createStash(): Promise<boolean> { return false; }
export async function popStash(): Promise<boolean> { return false; }
export async function dropStash(): Promise<boolean> { return false; }
```

- [ ] **Step 4: 删除 mergeBranchNoSwitch 和 mergeForward**

删除 `operations.ts` 中 `mergeBranchNoSwitch` 和 `mergeForward` 函数的完整定义。

然后搜索调用点：

```bash
cd P4GitTool.Electron && grep -n "mergeBranchNoSwitch\|mergeForward" electron/services/operations.ts
```

找到剩余调用点（在 `pull`、`checkAndUpdate`、`confirmSubmit` 中），这些调用点将在 Task 9-11 重写整个函数时替换，此处暂时添加 `// @ts-ignore` 和临时 stub：

```typescript
// 临时保留，让编译通过，Task 9-11 会重写这些调用点
async function mergeForward(
  _repo: string, _from: string, _base: string, _origin: string,
  _log: LogFn, _onConflict?: () => Promise<boolean>
): Promise<boolean> { return true; }
```

- [ ] **Step 5: 运行 lint 确认类型正确**

```bash
cd P4GitTool.Electron && npm run lint
```

Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add P4GitTool.Electron/electron/services/operations.ts
git commit -m "refactor: 清理 stash/branch 代码，修复 ESM import"
```

---

## Task 9: operations.ts — 重写 pull 加入 p4SyncKeep 收尾

让 pull 流程符合规格文档：sync 前保护、p4 sync、mirror/p4 更新、merge 到 stream 分支、p4 sync -k 收尾。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/operations.ts`

- [ ] **Step 1: 在 operations.ts 的 import 处新增 p4SyncKeep 导入**

确认 `import * as p4 from './p4';` 存在即可（`p4SyncKeep` 会通过 `p4.p4SyncKeep` 访问）。

- [ ] **Step 2: 重写 snapshotToMirror 使之不依赖 mergeForward**

找到 `snapshotToMirror` 函数，保持其实现不变（它只更新 `mirror/p4`，不做 merge）。已符合要求。

- [ ] **Step 3: 重写 pull 函数**

找到 `pull` 函数，完整替换为：

```typescript
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
```

- [ ] **Step 4: 运行 lint 确认通过**

```bash
cd P4GitTool.Electron && npm run lint
```

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/services/operations.ts
git commit -m "refactor: 重写 pull，新增 Sync 前保护与 p4 sync -k 收尾"
```

---

## Task 10: operations.ts — 重写 checkAndUpdate / submitPrepare

提交前流程：先 p4 sync -k 消除假改动 → 检查候选文件是否过期 → 过期则先同步 → p4 reconcile → 创建 Changelist → 打开 P4V。

> **注意**：本 Task 复用 `operations.ts` 中现有的 `buildCandidates`（约第 223 行）和 `checkOutdated`（约第 239 行）两个函数，不要删除它们。若这两个函数内部用到已被 Task 8 删除的 `mergeForward`，则改为直接调用 `git.gitMerge(repo, 'mirror/p4')`。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/operations.ts`

- [ ] **Step 1: 重写 checkAndUpdate**

在 `operations.ts` 中找到 `checkAndUpdate` 函数，完整替换为：

```typescript
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
```

- [ ] **Step 2: 重写 submitPrepare**

找到 `submitPrepare` 函数，替换为：

```typescript
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
```

- [ ] **Step 3: 重写 confirmSubmit**

找到 `confirmSubmit` 函数，替换为：

```typescript
export async function confirmSubmit(
  rootDir: string, stream: string, log: LogFn
): Promise<boolean> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return false; }

  const repo = repoPath(rootDir, stream);

  log('[INFO] 用户已在 P4V 完成提交，正在同步结果...');

  // 同步刚提交的文件（拉回 P4 上的最新版本）
  if (!await p4.p4Sync(cfg, stream, ['...'], false)) {
    log('[ERROR] p4 sync 失败'); return false;
  }

  // 更新 mirror/p4 并 merge 到当前分支
  const commitMsg = `submit: ${stream} 提交已完成 ${new Date().toISOString()}`;
  if (!await snapshotToMirror(repo, 'all', commitMsg, log)) return false;

  const curBranch = await git.currentBranch(repo);
  if (!await git.gitMerge(repo, 'mirror/p4')) {
    log('[WARN] 合并 mirror/p4 失败，请手动检查');
  }

  // 收尾
  await p4.p4SyncKeep(cfg, stream);

  log(`[OK] 提交流程完成`);
  return true;
}
```

- [ ] **Step 4: 运行 lint 确认通过**

```bash
cd P4GitTool.Electron && npm run lint
```

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/services/operations.ts
git commit -m "refactor: 重写 checkAndUpdate/submitPrepare/confirmSubmit"
```

---

## Task 11: operations.ts — 新增 commitSnapshot / rollbackTo / discardHunk / discardFile / listSnapshots

这些是 UI 层直接对应的五个操作。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/operations.ts`

- [ ] **Step 1: 在 operations.ts 顶部 import diff 相关**

在 `operations.ts` 顶部的 import 区块加入：

```typescript
import { parseUnifiedDiff, buildHunkReversePatch, buildLineReversePatch, DiffFile } from './diff';
import { getQueue } from './queue';
```

- [ ] **Step 2: 新增 commitSnapshot**

在 `operations.ts` 末尾追加：

```typescript
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
    // 确保无冲突状态
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
```

- [ ] **Step 3: 新增 listSnapshots**

```typescript
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
 * 列出当前分支的快照（含节点类型）。最新的在数组末尾。
 */
export async function listSnapshots(
  rootDir: string, stream: string, limit = 100
): Promise<SnapshotEntry[]> {
  const repo = repoPath(rootDir, stream);
  const { stdout } = await run(
    'git',
    ['log', `--max-count=${limit}`, '--format=%H|%P|%cI|%s', 'HEAD'],
    repo,
    true
  );
  const entries: SnapshotEntry[] = [];
  for (const line of stdout.split('\n').filter(Boolean)) {
    const [hash, parents, date, ...msgParts] = line.split('|');
    const message = msgParts.join('|');
    const parent = (parents ?? '').split(' ')[0] ?? '';

    // 计算该 commit 的文件数
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
  // git log 默认从新到旧，前端需要从旧到新
  return entries.reverse();
}
```

- [ ] **Step 4: 新增 rollbackTo**

```typescript
/**
 * 回滚到指定 commit（文件级别：git checkout <hash> -- .）
 * 前置条件：工作区必须干净（无未提交改动）。由调用方校验。
 */
export async function rollbackTo(
  rootDir: string, stream: string, hash: string, log: LogFn
): Promise<boolean> {
  const cfg = loadConfig();
  const sc = getStream(cfg, stream);
  if (!sc) { log(`[ERROR] Stream '${stream}' 未配置`); return false; }

  const repo = repoPath(rootDir, stream);
  const queue = getQueue(repo);

  return queue.enqueue(async () => {
    if (!await git.gitCheckClean(repo)) {
      log('[ERROR] 工作区有未提交的改动，回滚前请先提交快照或丢弃改动');
      return false;
    }

    const { code } = await run('git', ['checkout', hash, '--', '.'], repo, true);
    if (code !== 0) {
      log('[ERROR] git checkout 失败'); return false;
    }

    await p4.p4SyncKeep(cfg, stream);

    await run('git', ['add', '-A'], repo, true);
    const { stdout: st } = await run('git', ['status', '--porcelain'], repo, true);
    if (st.trim()) {
      if (!await git.gitCommit(repo, `revert: 回滚到 ${hash.slice(0, 7)}`)) {
        log('[ERROR] 回滚后 commit 失败'); return false;
      }
    }

    log(`[OK] 已回滚到 ${hash.slice(0, 7)}`);
    return true;
  });
}
```

- [ ] **Step 5: 新增 discardFile / discardHunk / discardLine**

```typescript
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
```

- [ ] **Step 6: 运行 lint 确认通过**

```bash
cd P4GitTool.Electron && npm run lint
```

Expected: 无错误。

- [ ] **Step 7: 提交**

```bash
git add P4GitTool.Electron/electron/services/operations.ts
git commit -m "feat: 新增 commitSnapshot/rollbackTo/discard/listSnapshots"
```

---

## Task 12: operations.ts — 修正改动文件列表基准

`getChangedFiles` 需要以 `mirror/p4` 为基准而非 HEAD，这样才能过滤掉 P4 还原产生的假改动。同时返回每个文件的状态（M/A/D）。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/operations.ts`

- [ ] **Step 1: 定位并重写 getChangedFiles**

在 `operations.ts` 中找到 `getChangedFiles`（若已存在），完整替换为：

```typescript
export interface ChangedFile {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | '?';
}

/**
 * 改动文件 = 相对 mirror/p4 的差异 + 工作区未提交文件（两者合并去重）。
 * 用 mirror/p4 为基准的目的是过滤掉 git checkout 还原文件产生的假改动。
 */
export async function getChangedFiles(
  rootDir: string, stream: string
): Promise<ChangedFile[]> {
  const repo = repoPath(rootDir, stream);

  // 1. mirror/p4 到 HEAD 之间的已提交差异
  const { stdout: committedOut } = await run(
    'git', ['diff', '--name-status', 'mirror/p4', 'HEAD'], repo, true
  );

  // 2. HEAD 到工作区的未提交差异（含暂存与未暂存）
  const { stdout: uncommittedOut } = await run(
    'git', ['diff', '--name-status', 'HEAD'], repo, true
  );

  // 3. 新文件还未被 git 跟踪
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

  consume(committedOut);
  consume(uncommittedOut);

  for (const p of untrackedOut.split('\n').filter(Boolean)) {
    if (!map.has(p)) map.set(p, { path: p, status: 'A' });
  }

  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}
```

- [ ] **Step 2: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

Expected: 无错误。

- [ ] **Step 3: 运行全部测试**

```bash
cd P4GitTool.Electron && npm run test
```

Expected: 之前所有测试仍然通过。

- [ ] **Step 4: 提交**

```bash
git add P4GitTool.Electron/electron/services/operations.ts
git commit -m "refactor: getChangedFiles 以 mirror/p4 为基准"
```

---

## Task 13: operations.ts — getFileDiff 返回结构化 diff

前端 DiffPanel 需要结构化数据渲染。封装一个 `getFileDiff` 返回解析后的 `DiffFile`。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/operations.ts`

- [ ] **Step 1: 在 operations.ts 末尾追加 getFileDiff**

```typescript
/**
 * 获取指定文件相对 mirror/p4 的结构化 diff。
 * 包含已提交和未提交的所有改动。
 */
export async function getFileDiff(
  rootDir: string, stream: string, filepath: string
): Promise<DiffFile | null> {
  const repo = repoPath(rootDir, stream);
  const { stdout } = await run(
    'git', ['diff', 'mirror/p4', '--', filepath], repo, true
  );
  if (!stdout.trim()) return null;
  const files = parseUnifiedDiff(stdout);
  return files[0] ?? null;
}
```

- [ ] **Step 2: 运行 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/electron/services/operations.ts
git commit -m "feat: getFileDiff 返回结构化 diff"
```

---

## Task 14: operations.ts — init 修正工作线分支名

`init` 当前会创建 `stream` 名的分支，按规格应保持如此（工作线 = stream 名），同时不再切换到 `mirror/p4` 之后再 `checkout -b`，简化逻辑。

**Files:**
- Modify: `P4GitTool.Electron/electron/services/operations.ts`

- [ ] **Step 1: 定位 init 函数，确认分支命名逻辑**

当前 init 函数末尾（约第 170-185 行）：
```typescript
if (!await git.branchExists(repo, stream)) {
  await git.gitCheckout(repo, 'mirror/p4');
  await run('git', ['checkout', '-b', stream], repo, true);
} else {
  await git.gitCheckout(repo, stream);
}
```

分支名已经使用 `stream`，符合规格。但代码用到了 `branchExists`（是本次要保留的 git.ts 函数，未删除）。确认 `git.ts` 中 `branchExists` 仍然存在（Task 7 未删除）：

```bash
cd P4GitTool.Electron && grep -n "export async function branchExists" electron/services/git.ts
```

Expected: 找到一行匹配。

- [ ] **Step 2: 如现有 init 中有对 snapshotToMirror 以外 merge 相关的调用，保留**

此 Task 只是确认性检查，无实际修改。若 init 能正常 lint 则跳到 Step 3。

```bash
cd P4GitTool.Electron && npm run lint
```

- [ ] **Step 3: 无改动则跳过提交**

（Task 14 通常不产生新 commit，仅做确认。）

---

## Task 15: 清理 operations.ts 中 Task 8 遗留的 stub

Task 8 为了让编译通过保留了 `listStashes / createStash / popStash / dropStash` 等空 stub。第 2 阶段（API 层）会删除引用，但本计划不能假设下一阶段执行，因此这些 stub 保留至下一阶段。

**本 Task 无修改**，仅作为文档提醒。

---

## Task 16: 集成冒烟测试（可选）

用一个真实的临时 git 仓库测试 operations 关键路径，确保各函数互相兼容。

**Files:**
- Create: `P4GitTool.Electron/electron/services/operations.integration.test.ts`

- [ ] **Step 1: 写集成测试**

Create: `P4GitTool.Electron/electron/services/operations.integration.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { run } from './runner';
import { parseUnifiedDiff, buildHunkReversePatch } from './diff';

/**
 * 不依赖 P4，只测纯 git 流程。
 * 构造一个临时仓库，模拟 "mirror/p4 + 用户分支" 的结构，
 * 验证 diff 解析 + git apply --reverse 能正确撤销 hunk。
 */
describe('git hunk discard flow (integration)', () => {
  let repo: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'p4git-int-'));
    await run('git', ['init', '-b', 'mirror/p4'], repo, true);
    await run('git', ['config', 'user.email', 'test@test'], repo, true);
    await run('git', ['config', 'user.name', 'Test'], repo, true);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nline2\nline3\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'init'], repo, true);
    await run('git', ['checkout', '-b', 'dev'], repo, true);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('apply --reverse 可撤销一个 hunk', async () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nline2\nlineX\nline3\n');

    const { stdout: diff } = await run('git', ['diff', 'mirror/p4'], repo, true);
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);

    const patch = buildHunkReversePatch(files[0], files[0].hunks[0]);
    const { code } = await run('git', ['apply', '--reverse', '--whitespace=nowarn', '-'], repo, true, patch);
    expect(code).toBe(0);

    const content = fs.readFileSync(path.join(repo, 'a.txt'), 'utf-8');
    expect(content).toBe('line1\nline2\nline3\n');
  });
});
```

- [ ] **Step 2: 运行集成测试**

```bash
cd P4GitTool.Electron && npm run test -- integration
```

Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/electron/services/operations.integration.test.ts
git commit -m "test: hunk discard 集成测试"
```

---

## Task 17: 最终 lint + 全部测试

- [ ] **Step 1: 全仓库 lint**

```bash
cd P4GitTool.Electron && npm run lint
```

Expected: 退出码 0。

- [ ] **Step 2: 全部测试**

```bash
cd P4GitTool.Electron && npm run test
```

Expected: 全绿。

- [ ] **Step 3: 如有失败，修复后单独提交**

---

## 自检清单（规格覆盖）

以下规格条目在本计划中的对应 Task：

| 规格要求 | 对应 Task |
|---|---|
| `mirror/p4` 为基准的 diff | Task 12（getChangedFiles）、Task 13（getFileDiff） |
| 工作线分支名 = stream 名 | Task 14（init 已满足） |
| `p4 sync -k` 收尾 | Task 5（p4SyncKeep）, Task 9/10/11（所有写操作后调用） |
| Sync 前自动保护 | Task 9（pull 检测 dirty 则先 commit） |
| 手动快照 | Task 11（commitSnapshot） |
| P4 Submit 流程 | Task 10（checkAndUpdate/submitPrepare/confirmSubmit） |
| 时间线节点列表 | Task 11（listSnapshots + SnapshotKind 分类） |
| 回滚到节点 | Task 11（rollbackTo，校验工作区干净） |
| Hunk 级别撤销 | Task 3（diff.ts）+ Task 11（discardHunk） |
| 单行撤销 | Task 3（buildLineReversePatch）+ Task 11（discardLine） |
| 还原整个文件 | Task 11（discardFile） |
| 删除 stash 相关 | Task 8 |
| `p4CreateChangelist` 修复 | Task 4 |
| ESM import 修复 | Task 8 |
| 文件监听（仅刷新 UI） | Task 6 |
| 写操作串行化 | Task 2 + Task 11（各操作用 getQueue） |
| `runner.ts` stdin 支持 | Task 1 |

未覆盖项（Plan 2/3 将处理）：
- API 路由新增与旧路由清理 → Plan 2
- SSE `changed` 事件推送 → Plan 2
- 前端 UI 重构 → Plan 3

---

## 执行建议

本计划包含 17 个 Task，约 60-70 个步骤。建议按 subagent-driven-development 方式执行：每个 Task 派发一个独立 subagent，完成后 review 再进下一个。关键检查点：

- Task 4 完成后：手动跑一次 `p4 change -i` 验证 stdin 确实传入（可临时 log）
- Task 9 完成后：人工 Pull 一次，观察日志中 Sync 前保护节点是否产生
- Task 11 完成后：在 Fork 里查看 Git 仓库，确认 commit 历史符合预期

如遇测试偶发失败（chokidar 在 Windows 上 ready 时间不稳），可将相关等待延长 100-200 ms。










