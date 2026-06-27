---
类型: 技术方案
项目: P4GitTool
日期: 2026-06-27
标签: [P4GitTool, 快照勾选, VSCode, 部分提交]
---

# P4Git Tool 两项功能设计：快照勾选 + VSCode 打开项目

> 本文档为设计阶段产物，落盘于 `docs/superpowers/specs/`。实现以代码为准。

## 背景

P4Git Tool 当前「提交快照」是 `git add -A` 一次性提交全部改动，无法只提交部分文件。
同时 TabBar 已有「打开 Claude」按钮，但缺少「在 VSCode 中打开项目」的快捷入口（仅文件右键菜单有单文件的 `code --goto`）。

本次新增两项功能：

1. **快照勾选**：支持取消勾选部分文件，将其排除出本次快照（真正的部分提交）。
2. **VSCode 打开项目按钮**：在 TabBar 加一个按钮，一键用 VSCode 打开当前工作区。

---

## 功能一：快照勾选

### 语义

- **默认全选**：所有改动文件默认纳入本次快照。
- **取消勾选 = 排除**：取消勾选的文件排除出本次快照，改动仍保留在工作区，下次仍可提交。
- 这是**真正的部分提交**：后端从 `git add -A` 改为按纳入列表 `git add <files...>` 再 commit。

### 勾选状态生命周期

- **临时状态，不落盘**：勾选状态存在前端 Zustand store，仅活在当前会话。
- **重置时机**：
  - 提交快照后（被提交文件从列表消失，剩余文件下次默认全勾选）
  - 切换 stream
  - 文件列表刷新（`files-changed` 事件 / 手动刷新）后，新出现的文件默认勾选
- 实现上：store 维护「**排除集合** `Set<filepath>`」按 stream 区分。默认空集 = 全选。这样新文件天然默认纳入，无需逐个初始化。

### 交互与视觉

文件列表（`FileList.tsx`，宽 220px，VSCode 深色主题）每行：

| 状态 | 表现 |
|------|------|
| 纳入（默认） | 左侧绿色竖条 `border-left:3px solid #4ec9b0` 常驻 |
| 排除 | 无竖条（`transparent`）+ 文件名灰暗划线（`#666` + `line-through`）+ 状态字母变暗（`opacity:.4`）|
| checkbox | 所有行仅 **hover 时浮现**（`visibility:hidden` → `:hover` 显示），勾选态 `#007acc` 蓝底白勾 |

- **点击区域分离**（关键，避免冲突）：
  - 点 hover 出现的 **checkbox** → 切换纳入/排除
  - 点**文件名其余区域** → 看 diff（现有行为不变）
- **提交按钮**：文字显示纳入数量 `⊙ 提交快照 (3)`；当纳入数为 0 时禁用（与现有「无改动时禁用」逻辑合并）。
- 仅在正常模式生效；历史查看模式（`isViewing`）不显示 checkbox / 色条。

### 数据流

```
前端 store: excludedByStream: Record<stream, Set<filepath>>
  ├─ toggleExclude(stream, filepath)  切换
  ├─ 计算 includedFiles = ws.changes.filter(f => !excluded.has(f.path))
  └─ 提交快照时传 includedFiles 的 path[] 给后端

SnapshotDialog.runSnapshot(message)
  → api.snapshot(stream, message, files)   // files: string[] 新增参数
  → POST /api/snapshot { stream, message, files }
  → ops.commitSnapshot(rootDir, stream, message, files, log)
```

### 后端改动

`electron/services/snapshot.ts` 的 `commitSnapshot`：

- 新增参数 `files?: string[]`（纳入文件的仓库相对路径）。
- `files` 为 `undefined` 或空 → 保持旧行为 `git add -A`（向后兼容 / 全选场景）。
- `files` 非空 → `git add -- <files...>`（仅暂存纳入文件），其余改动留在工作区。
  - 注意删除文件：`git add -- <path>` 对已删除文件会暂存删除，行为正确。
  - 路径含空格 / 特殊字符：通过 spawn 数组参数传递（runner 已是数组式 spawn，无需手动转义）。
- commit 前的 `git status --porcelain` 检查改为检查**暂存区**是否有内容（`git diff --cached --name-only`），因为部分提交时工作区仍有未暂存改动，不能用整体 porcelain 判断「无改动」。

`electron/routes/operations.ts` 的 `/snapshot`：

- 从 body 读取 `files`，透传给 `commitSnapshot`。

### 边界情况

- **全部取消勾选**：提交按钮禁用，无法触发。
- **提交后**：被提交文件从 `changes` 消失，排除集合中已不存在的路径自然失效；保险起见提交成功后清空该 stream 的排除集合。
- **排除集合中的文件被外部删除/还原**：路径不在 `changes` 里就不影响（计算 includedFiles 时以 `changes` 为基准过滤）。

---

## 功能二：VSCode 打开项目按钮

### 位置与交互

- 在 `TabBar.tsx` 右侧按钮组，「打开 Claude」（Bot 图标）旁边加一个 VSCode 按钮。
- 图标：用 lucide 的 `Code2`（或 `FileCode`）。
- title：`在 VSCode 中打开当前工作区`。
- 点击 → `api.openProjectInVscode(currentStream)`。

### 打开哪个目录（关键决策）

工具里有两个相关目录：
- **git 工作区** `repoPath` = `<workspaces_dir>/ProjectX_<stream>_git`（agent 在这里工作，「打开 Claude」打开的是这里）
- **P4 项目根** `sc.root/ProjectX`（P4 实际签出位置，单文件 VSCode 打开用的是这里，靠 junction 链接）

**决策：打开 git 工作区 `repoPath`**，与「打开 Claude」保持一致。
理由：用户在工具里的心智模型是「这个工作区」，Claude 和 VSCode 应指向同一处；且 git 工作区通过 junction 能访问到所有项目文件，diff/版本信息也在这里。

> 注：现有单文件右键「在 VSCode 中打开」走的是 `sc.root/ProjectX`。两者目录不同但因 junction 指向同一份文件，不冲突。本按钮打开项目根用 `repoPath`，统一工作区入口。

### 后端改动

`electron/routes/operations.ts` 新增路由 `/open-project-in-vscode`：

```ts
router.post('/open-project-in-vscode', async (req, res) => {
  const { stream } = req.body ?? {};
  if (!stream) { res.status(400).json({ error: 'stream required' }); return; }
  const repo = repoPath(getRootDir(), stream);
  const proc = spawn('code', [repo], { detached: true, stdio: 'ignore', shell: true });
  proc.unref();
  res.json({ ok: true });
});
```

### 前端改动

- `api/client.ts` 新增 `openProjectInVscode(stream)`。
- `TabBar.tsx` 加按钮。

---

## 涉及文件清单

后端：
- `electron/services/snapshot.ts` — `commitSnapshot` 增加 `files` 参数 + 暂存判断逻辑
- `electron/routes/operations.ts` — `/snapshot` 透传 files；新增 `/open-project-in-vscode`

前端：
- `src/store/appStore.ts` — 排除集合状态 + toggle action + runSnapshot 传 files + 重置逻辑
- `src/api/client.ts` — `snapshot` 增加 files 参数；新增 `openProjectInVscode`
- `src/components/FileList.tsx` — FileItem 加 checkbox/色条/排除态样式、点击分区；提交按钮显示数量
- `src/components/SnapshotDialog.tsx` — runSnapshot 调用对齐（传 files）
- `src/components/TabBar.tsx` — VSCode 按钮

测试：
- `electron/services/snapshot.integration.test.ts` — 补部分提交用例（纳入子集、删除文件、空暂存判断）

---

## 验证方式

- `npx tsc --noEmit` 编译通过
- snapshot 集成测试通过（含部分提交场景）
- 手动：打包后在稳定版/测试版验证勾选交互、部分提交结果、VSCode 按钮打开正确目录

---

## 不做（YAGNI）

- 不做勾选状态持久化（明确选了临时状态）
- 不做「全选/全不选」批量按钮（先看实际需要）
- 不改单文件右键「在 VSCode 中打开」的现有行为
