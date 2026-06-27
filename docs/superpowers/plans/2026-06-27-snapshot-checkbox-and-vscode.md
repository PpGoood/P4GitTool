# 快照勾选 + VSCode 打开项目 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让提交快照支持取消勾选部分文件（真部分提交），并在 TabBar 加「在 VSCode 中打开项目」按钮。

**Architecture:** 后端 `commitSnapshot` 接收纳入文件列表，按列表 `git add` 后 commit；前端用 Zustand 维护按 stream 的「排除集合」（临时态），FileList 行加色条/hover-checkbox/排除态样式，点击区域分离（checkbox 切换、文件名看 diff）。VSCode 按钮复用 open-claude 的 spawn 模式打开 git 工作区。

**Tech Stack:** Electron + Express（后端）、React 19 + Zustand + Tailwind（前端）、Vitest（测试）、lucide-react（图标）。

## Global Constraints

- 所有命令通过 `run(cmd, args[], cwd, silent)` 执行（runner.ts 数组式 spawn，路径无需手动转义）。
- 强制 LF 换行，禁止引入 CRLF。
- 服务端 git 操作走每仓串行队列 `getQueue(repo).enqueue(...)`。
- 工作目录：仓库路径 = `repoPath(rootDir, stream)` = `<workspaces_dir>/ProjectX_<stream>_git`。
- 编译验证命令（在 `P4GitTool.Electron/` 下）：`npx tsc --noEmit`。
- 测试命令（在 `P4GitTool.Electron/` 下）：`npx vitest run <file>`。
- 提交信息遵循 `type: 中文描述` 规范（feat/fix/refactor + 中文）。

---

### Task 1: 后端 commitSnapshot 支持部分提交

**Files:**
- Modify: `P4GitTool.Electron/electron/services/snapshot.ts:14-41`
- Test: `P4GitTool.Electron/electron/services/snapshot.integration.test.ts`（新增 describe 块）

**Interfaces:**
- Consumes: `run(cmd, args, cwd, silent)`、`getQueue(repo)`、`git.gitCommit(repo, message)`、`git.hasMergeConflict(repo)`、`repoPath`、`loadConfig`、`getStream`、`LogFn`
- Produces: `commitSnapshot(rootDir: string, stream: string, message: string, files: string[] | undefined, log: LogFn): Promise<boolean>` — `files` 为 undefined/空数组时全量提交（`git add -A`），非空时只 `git add -- <files>` 后提交。

- [ ] **Step 1: 写失败测试**

在 `snapshot.integration.test.ts` 末尾新增 describe 块。复用文件顶部已有的 `run`、`fs`、`path`、`os` import，复制现有 setupRepo 模式（每个 describe 自带 setup，因为现有 setupRepo 在另一个 describe 作用域内）：

```ts
describe('commitSnapshot 部分提交 (integration)', () => {
  let rootDir: string;
  let repo: string;

  beforeEach(async () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4git-commit-'));
    repo = path.join(rootDir, 'ProjectX_dev_git');
    fs.mkdirSync(path.join(repo, 'Source'), { recursive: true });
    await run('git', ['init', '-b', 'dev'], repo, true);
    await run('git', ['config', 'user.email', 'test@test'], repo, true);
    await run('git', ['config', 'user.name', 'Test'], repo, true);
    await run('git', ['config', 'core.autocrlf', 'false'], repo, true);
    fs.writeFileSync(path.join(repo, 'Source', 'base.cpp'), 'int base = 0;\n');
    await run('git', ['add', '.'], repo, true);
    await run('git', ['commit', '-m', 'init'], repo, true);
  });

  afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  // 测试桩：commitSnapshot 需要 config 已加载（loadConfig 读 configPath）。
  // setConfigPath 指向一个最小 config，使 getStream('dev') 命中。
  async function withConfig() {
    const { setConfigPath } = await import('./config');
    const cfgPath = path.join(rootDir, 'config.yaml');
    fs.writeFileSync(
      cfgPath,
      `p4_port: ""\np4_user: ""\nworkspaces_dir: "${rootDir.replace(/\\/g, '/')}"\nstreams:\n  - name: dev\n    client: c\n    root: "${rootDir.replace(/\\/g, '/')}"\n`
    );
    setConfigPath(cfgPath);
  }

  function changedNames(out: string) {
    return out.split('\n').map(l => l.trim()).filter(Boolean);
  }

  it('files 指定子集时只提交该子集，其余改动留在工作区', async () => {
    await withConfig();
    fs.writeFileSync(path.join(repo, 'Source', 'a.cpp'), 'int a = 1;\n');
    fs.writeFileSync(path.join(repo, 'Source', 'b.cpp'), 'int b = 2;\n');

    const { commitSnapshot } = await import('./snapshot');
    const ok = await commitSnapshot(rootDir, 'dev', 'only a', ['Source/a.cpp'], () => {});
    expect(ok).toBe(true);

    // a.cpp 已进入 HEAD
    const { stdout: head } = await run('git', ['show', '--name-only', '--format=', 'HEAD'], repo, true);
    expect(changedNames(head)).toContain('Source/a.cpp');
    expect(changedNames(head)).not.toContain('Source/b.cpp');

    // b.cpp 仍是未跟踪/改动
    const { stdout: st } = await run('git', ['status', '--porcelain'], repo, true);
    expect(st).toContain('b.cpp');
  });

  it('files 为 undefined 时全量提交', async () => {
    await withConfig();
    fs.writeFileSync(path.join(repo, 'Source', 'a.cpp'), 'int a = 1;\n');
    fs.writeFileSync(path.join(repo, 'Source', 'b.cpp'), 'int b = 2;\n');

    const { commitSnapshot } = await import('./snapshot');
    const ok = await commitSnapshot(rootDir, 'dev', 'all', undefined, () => {});
    expect(ok).toBe(true);

    const { stdout: st } = await run('git', ['status', '--porcelain'], repo, true);
    expect(st.trim()).toBe('');
  });

  it('files 指定的文件无实际改动时返回 false', async () => {
    await withConfig();
    // 没有任何改动
    const { commitSnapshot } = await import('./snapshot');
    const ok = await commitSnapshot(rootDir, 'dev', 'noop', ['Source/base.cpp'], () => {});
    expect(ok).toBe(false);
  });

  it('部分提交删除文件', async () => {
    await withConfig();
    fs.rmSync(path.join(repo, 'Source', 'base.cpp'));
    fs.writeFileSync(path.join(repo, 'Source', 'a.cpp'), 'int a = 1;\n');

    const { commitSnapshot } = await import('./snapshot');
    const ok = await commitSnapshot(rootDir, 'dev', 'del base', ['Source/base.cpp'], () => {});
    expect(ok).toBe(true);

    const { code } = await run('git', ['cat-file', '-e', 'HEAD:Source/base.cpp'], repo, true);
    expect(code).not.toBe(0); // base.cpp 已从 HEAD 删除

    // a.cpp 未提交，仍在工作区
    const { stdout: st } = await run('git', ['status', '--porcelain'], repo, true);
    expect(st).toContain('a.cpp');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run（在 `P4GitTool.Electron/`）：`npx vitest run electron/services/snapshot.integration.test.ts`
Expected: 新增的 4 个用例 FAIL（当前 `commitSnapshot` 只接受 4 个参数，传第 5 个 `() => {}` 会让 message 错位 / files 被忽略，断言不通过）。

- [ ] **Step 3: 改写 commitSnapshot**

替换 `snapshot.ts` 第 11-41 行（函数签名 + 函数体）：

```ts
/**
 * 用户手动触发的快照。
 * - files 为 undefined/空 → git add -A（全量提交，向后兼容）
 * - files 非空 → 仅 git add -- <files>（部分提交），其余改动留在工作区
 * 用暂存区（git diff --cached）判断是否有可提交内容，而非整体 porcelain，
 * 因为部分提交时工作区仍有未暂存改动。
 */
export async function commitSnapshot(
  rootDir: string, stream: string, message: string,
  files: string[] | undefined, log: LogFn
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

    if (files && files.length > 0) {
      // 部分提交：先清空暂存区，再只暂存纳入文件，避免残留之前的暂存内容
      await run('git', ['reset'], repo, true);
      await run('git', ['add', '--', ...files], repo, true);
    } else {
      await run('git', ['add', '-A'], repo, true);
    }

    // 用暂存区判断是否有可提交内容
    const { stdout: staged } = await run('git', ['diff', '--cached', '--name-only'], repo, true);
    if (!staged.trim()) {
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

- [ ] **Step 4: 运行测试确认通过**

Run：`npx vitest run electron/services/snapshot.integration.test.ts`
Expected: 全部 PASS（含原有 listSnapshots 用例 + 新增 4 个部分提交用例）。

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/electron/services/snapshot.ts P4GitTool.Electron/electron/services/snapshot.integration.test.ts
git commit -m "feat: commitSnapshot 支持部分提交(按文件列表暂存)"
```

---

### Task 2: 后端路由透传 files + 新增 VSCode 打开项目路由

**Files:**
- Modify: `P4GitTool.Electron/electron/routes/operations.ts:34-42`（/snapshot）
- Modify: `P4GitTool.Electron/electron/routes/operations.ts:103`（新增路由，return router 前）

**Interfaces:**
- Consumes: `ops.commitSnapshot(rootDir, stream, message, files, log)`（Task 1）、`repoPath`、`spawn`
- Produces: `POST /api/snapshot` 接收 body `{ stream, message, files? }`；`POST /api/open-project-in-vscode` 接收 body `{ stream }`。

- [ ] **Step 1: 改 /snapshot 透传 files**

替换 operations.ts 第 34-42 行：

```ts
  router.post('/snapshot', async (req, res) => {
    const { stream, message, files } = req.body ?? {};
    if (!stream || !message) { res.status(400).json({ error: 'stream and message required' }); return; }
    try {
      const ok = await ops.commitSnapshot(getRootDir(), stream, message, files, makeLogFn());
      emitDone('snapshot', stream, ok);
      res.json({ ok });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
```

- [ ] **Step 2: 新增 open-project-in-vscode 路由**

在 `return router;`（约第 105 行）之前插入。注意 `spawn` 与 `repoPath` 已在文件顶部 import（`spawn` 来自 child_process 第 2 行；`repoPath` 来自 config 第 5 行）：

```ts
  // 用 VSCode 打开整个 git 工作区（与 open-claude 指向同一目录）
  router.post('/open-project-in-vscode', async (req, res) => {
    const { stream } = req.body ?? {};
    if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
    const repo = repoPath(getRootDir(), stream);
    const proc = spawn('code', [repo], { detached: true, stdio: 'ignore', shell: true });
    proc.unref();
    res.json({ ok: true });
  });
```

- [ ] **Step 3: 编译验证**

Run（在 `P4GitTool.Electron/`）：`npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add P4GitTool.Electron/electron/routes/operations.ts
git commit -m "feat: /snapshot 透传 files，新增 /open-project-in-vscode 路由"
```

---

### Task 3: 前端 api client 扩展

**Files:**
- Modify: `P4GitTool.Electron/src/api/client.ts:191-198`

**Interfaces:**
- Consumes: `post<T>(path, body)`
- Produces: `api.snapshot(stream, message, files?)` — 新增可选 `files: string[]` 参数；`api.openProjectInVscode(stream)` — 新方法。

- [ ] **Step 1: 改 snapshot 签名 + 加 openProjectInVscode**

替换 client.ts 第 191-198 行（`snapshot`、`submitPrepare`、`openInVscode`、`openClaude` 这段）：

```ts
  snapshot: (stream: string, message: string, files?: string[]) =>
    post<{ ok: boolean }>('/snapshot', { stream, message, files }),
  submitPrepare: (stream: string) =>
    post<SubmitPrepareResult>('/submit-prepare', { stream }),
  openInVscode: (stream: string, filepath: string) =>
    post<{ ok: boolean }>('/open-in-vscode', { stream, filepath }),
  openProjectInVscode: (stream: string) =>
    post<{ ok: boolean }>('/open-project-in-vscode', { stream }),
  openClaude: (stream: string) =>
    post<{ ok: boolean }>('/open-claude', { stream }),
```

- [ ] **Step 2: 编译验证**

Run（在 `P4GitTool.Electron/`）：`npx tsc --noEmit`
Expected: 无错误（此时 store 的 `runSnapshot` 仍只传 2 参，因 files 可选不报错）。

- [ ] **Step 3: 提交**

```bash
git add P4GitTool.Electron/src/api/client.ts
git commit -m "feat: api client 新增 openProjectInVscode、snapshot 支持 files"
```

---

### Task 4: 前端 store 排除集合状态

**Files:**
- Modify: `P4GitTool.Electron/src/store/appStore.ts`（AppState 接口 + 初始 state + 多处 action）

**Interfaces:**
- Consumes: `api.snapshot(stream, message, files)`（Task 3）、`patchWorkspace`、`get().workspaces[stream].changes`
- Produces:
  - state `excludedByStream: Record<string, string[]>`（排除文件路径，按 stream；用数组而非 Set 便于 Zustand 浅比较与序列化）
  - `toggleExclude(stream: string, filepath: string): void`
  - `isExcluded(stream: string, filepath: string): boolean`
  - `clearExcluded(stream: string): void`
  - `runSnapshot(message)` 改为提交时计算 includedFiles 并传给 api，成功后清空该 stream 排除集合。

- [ ] **Step 1: 接口与初始 state**

在 `AppState` 接口里，`workspaces` 字段后（约第 40 行后）加：

```ts
  // 快照勾选：按 stream 记录被排除（取消勾选）的文件路径。临时态，不落盘。
  excludedByStream: Record<string, string[]>;
```

在 actions 区（`setCurrentStream` 声明附近，约第 60 行后）加声明：

```ts
  toggleExclude: (stream: string, filepath: string) => void;
  isExcluded: (stream: string, filepath: string) => boolean;
  clearExcluded: (stream: string) => void;
```

在 `create` 初始 state（`workspaces: ,` 后，约第 105 行）加：

```ts
  excludedByStream: {},
```

- [ ] **Step 2: 实现三个 action**

在 `patchWorkspace` 实现之后（约第 147 行后）插入：

```ts
  toggleExclude: (stream, filepath) => set((s) => {
    const cur = s.excludedByStream[stream] ?? [];
    const next = cur.includes(filepath)
      ? cur.filter((p) => p !== filepath)
      : [...cur, filepath];
    return { excludedByStream: { ...s.excludedByStream, [stream]: next } };
  }),

  isExcluded: (stream, filepath) =>
    (get().excludedByStream[stream] ?? []).includes(filepath),

  clearExcluded: (stream) => set((s) => {
    if (!s.excludedByStream[stream]?.length) return {} as any;
    const next = { ...s.excludedByStream };
    delete next[stream];
    return { excludedByStream: next };
  }),
```

- [ ] **Step 3: setCurrentStream 切换时清空排除集合**

`setCurrentStream` 的 `set({...})` 里（约第 119-128 行）已重置多项视图状态。在该对象里加一行清空当前要切入 stream 的残留（保守起见整体不动其他 stream，仅清目标）。改为在 `set` 后、`refreshWorkspace` 前调用 `get().clearExcluded(stream)`：

```ts
  setCurrentStream: (stream) => {
    set({
      currentStream: stream,
      isDetached: false,
      viewingNode: null,
      viewingFiles: [],
      viewingDiff: null,
      viewingSelectedFile: null,
      viewMode: VIEW_NORMAL,
    });
    get().clearExcluded(stream);
    get().refreshWorkspace(stream);
  },
```

- [ ] **Step 4: runSnapshot 计算 includedFiles 并传参**

替换 `runSnapshot`（约第 316-327 行）：

```ts
  runSnapshot: async (message) => {
    const s = get().currentStream;
    if (!s) return false;
    set({ isLoading: true, loadingOp: 'snapshot' });
    try {
      const ws = get().workspaces[s];
      const excluded = get().excludedByStream[s] ?? [];
      const allPaths = (ws?.changes ?? []).map((f) => f.path);
      const included = allPaths.filter((p) => !excluded.includes(p));
      // 无排除时传 undefined → 后端走 git add -A（全量）
      const files = excluded.length > 0 ? included : undefined;
      const { ok } = await api.snapshot(s, message, files);
      if (ok) {
        get().clearExcluded(s);
        await get().refreshWorkspace(s);
      }
      return ok;
    } finally {
      set({ isLoading: false, loadingOp: null });
    }
  },
```

- [ ] **Step 5: 编译验证**

Run（在 `P4GitTool.Electron/`）：`npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add P4GitTool.Electron/src/store/appStore.ts
git commit -m "feat: store 新增快照排除集合状态与 toggle/clear action"
```

---

### Task 5: FileList 勾选交互与视觉

**Files:**
- Modify: `P4GitTool.Electron/src/components/FileList.tsx`（FileItem 组件 + 列表渲染 + 提交按钮）

**Interfaces:**
- Consumes: `useAppStore` 的 `toggleExclude`、`excludedByStream`、`runSnapshot`、`useCurrentWorkspace`、`currentStream`
- Produces: 无（纯 UI）。

- [ ] **Step 1: FileItem 增加 excluded / onToggle props 与样式**

替换 `FileItem` 组件（第 26-51 行）。要点：纳入态左侧绿色竖条常驻；排除态无竖条+灰暗划线+状态字母变暗；checkbox 仅 hover 显示（`group-hover`），排除态不常驻空框；点 checkbox 切换，点其余区域 onClick（看 diff）：

```tsx
function FileItem({ f, active, excluded, onClick, onToggle, onContextMenu }: {
  f: FileChange;
  active: boolean;
  excluded: boolean;
  onClick: () => void;
  onToggle: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const parts = f.path.split('/');
  const name = parts[parts.length - 1];
  const dir = parts.slice(0, -1).join('/');
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`group w-full text-left pr-3 py-1.5 flex items-center gap-2 border-b border-[#2a2a2a] cursor-pointer
        border-l-[3px] ${excluded ? 'border-l-transparent bg-[#1d1d1d]' : 'border-l-[#4ec9b0]'}
        ${active ? 'bg-[#2a2d2e]' : 'hover:bg-[#2a2a2a]'}`}
    >
      {/* checkbox：仅 hover 行时显示；点击切换纳入/排除，stopPropagation 防触发看 diff */}
      <span
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        title={excluded ? '点击纳入本次快照' : '点击排除出本次快照'}
        className={`ml-2 w-[13px] h-[13px] flex-shrink-0 rounded-[3px] border flex items-center justify-center text-[9px] leading-none
          ${excluded
            ? 'border-[#888] text-transparent invisible group-hover:visible'
            : 'bg-[#007acc] border-[#007acc] text-white invisible group-hover:visible'}`}
      >
        {excluded ? '' : '✓'}
      </span>
      <span className={`text-[9px] font-bold w-3 ${statusClass(f.status)} ${excluded ? 'opacity-40' : ''}`}>
        {statusLetter(f.status)}
      </span>
      <div className="flex-1 min-w-0">
        <div className={`text-[11px] truncate ${excluded ? 'text-[#666] line-through' : 'text-[#ccc]'}`}>{name}</div>
        {dir && <div className="text-[10px] text-[#666] truncate">{dir}/</div>}
      </div>
    </div>
  );
}
```

注意：原 `<button>` 改为 `<div>`，因为内部要嵌套可点击的 checkbox（button 嵌 button 非法）。`onClick` 看 diff 行为不变。

- [ ] **Step 2: 列表渲染传入 excluded / onToggle**

在 `FileList` 组件里，先取 store 的相关方法（在已有 useAppStore 调用区，约第 65 行后加）：

```tsx
  const toggleExclude = useAppStore((s) => s.toggleExclude);
  const excludedList = useAppStore((s) => s.excludedByStream[s.currentStream] ?? []);
```

替换 `displayFiles.map(...)` 渲染块（第 198-209 行）：

```tsx
        {displayFiles.map((f) => (
          <FileItem
            key={f.path}
            f={f}
            active={selectedFile === f.path}
            excluded={!isViewing && excludedList.includes(f.path)}
            onClick={() => isViewing ? viewNodeSelectFile(f.path) : selectFile(currentStream, f.path)}
            onToggle={() => currentStream && toggleExclude(currentStream, f.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, filepath: f.path });
            }}
          />
        ))}
```

注意：历史查看模式（isViewing）下 excluded 恒为 false，checkbox 虽存在但 toggle 走 viewing 分支无副作用；视觉上历史模式色条仍显示绿色（纳入态）——可接受，因为该模式不提交。

- [ ] **Step 3: 提交按钮显示纳入数量并据此禁用**

替换「提交快照」按钮（第 215-221 行）。计算纳入数：

在 return 之前（约第 113 行 `selectedFile` 定义后）加：

```tsx
  const includedCount = ws.changes.filter((f) => !excludedList.includes(f.path)).length;
```

按钮改为：

```tsx
          <button
            onClick={() => setSnapshotOpen(true)}
            disabled={isLoading || includedCount === 0}
            className="bg-[#007acc] hover:bg-[#1c91ea] disabled:opacity-50 text-white text-[11px] font-bold py-1.5 rounded"
          >
            ⊙ 提交快照{ws.changes.length > 0 ? ` (${includedCount})` : ''}
          </button>
```

- [ ] **Step 4: 编译验证**

Run（在 `P4GitTool.Electron/`）：`npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add P4GitTool.Electron/src/components/FileList.tsx
git commit -m "feat: 文件列表勾选交互(色条+hover checkbox+排除态样式)"
```

---

### Task 6: TabBar 新增 VSCode 打开项目按钮

**Files:**
- Modify: `P4GitTool.Electron/src/components/TabBar.tsx:2`（import 图标）、`:53-67`（按钮组）

**Interfaces:**
- Consumes: `api.openProjectInVscode(stream)`（Task 3）、`currentStream`
- Produces: 无（纯 UI）。

- [ ] **Step 1: import Code2 图标**

替换第 2 行：

```tsx
import { RefreshCcw, Settings, Bot, Code2 } from 'lucide-react';
```

- [ ] **Step 2: 在「打开 Claude」按钮前加 VSCode 按钮**

在按钮组里，「打开 Claude」按钮（第 54-60 行）之前插入：

```tsx
        <button
          onClick={() => currentStream && api.openProjectInVscode(currentStream)}
          title="在 VSCode 中打开当前工作区"
          className="w-7 h-7 flex items-center justify-center text-[#888] hover:text-[#ccc] hover:bg-[#3c3c3c] rounded"
        >
          <Code2 size={15} />
        </button>
```

- [ ] **Step 3: 编译验证**

Run（在 `P4GitTool.Electron/`）：`npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add P4GitTool.Electron/src/components/TabBar.tsx
git commit -m "feat: TabBar 加「在 VSCode 中打开」按钮"
```

---

### Task 7: 全量编译 + 打包 + 更新稳定版

**Files:** 无（构建与发布）

- [ ] **Step 1: 全量类型检查**

Run（在 `P4GitTool.Electron/`）：`npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 2: 跑全部测试**

Run（在 `P4GitTool.Electron/`）：`npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 3: 打包**

Run（在 `P4GitTool.Electron/`）：`npm run package:dir`
Expected: 生成 `release/win-unpacked`。

- [ ] **Step 4: 更新稳定版**

把 `release/win-unpacked` 复制到 `D:\work\p4git\app-stable`（覆盖）。
> 此步影响用户日常使用的稳定版，属发布动作，执行前与用户确认。

- [ ] **Step 5: 手动验证清单**（用户在稳定版/测试版操作）

- 文件列表 hover 出现 checkbox；点击 checkbox 切换排除态（灰暗划线、无绿条）
- 点文件名仍能看 diff（不被 checkbox 干扰）
- 提交按钮显示纳入数量，全排除时禁用
- 取消勾选某文件后提交快照 → 该文件仍在改动列表（未被提交），其余文件已提交
- 提交后剩余文件恢复全勾选（绿条）
- TabBar VSCode 按钮打开 git 工作区目录

- [ ] **Step 6: 最终提交（如打包产物纳入版本管理则提交，否则跳过）**

```bash
git add -A
git commit -m "build: 快照勾选 + VSCode 打开项目 打包"
```

---

## 自查结论

- **Spec 覆盖**：语义/生命周期/交互视觉/后端改动/VSCode 按钮/边界情况均有对应 Task（Task1 后端部分提交+暂存判断，Task4 生命周期重置，Task5 交互视觉+点击分离+按钮计数，Task2/3/6 路由与按钮）。
- **类型一致**：`commitSnapshot(... files, log)` 在 Task1 定义、Task2 调用一致；`api.snapshot(stream, message, files?)` Task3 定义、Task4 调用一致；`toggleExclude/isExcluded/clearExcluded/excludedByStream` 命名贯穿 Task4/5。
- **无占位符**：所有代码步骤含完整代码与确切命令。
- **边界**：全排除→按钮禁用（Task5 Step3）；提交后清空排除集合（Task4 Step4）；删除文件部分提交（Task1 测试覆盖）。
