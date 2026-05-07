# P4Git Tool 重设计规格文档

**日期**：2026-05-06  
**状态**：已确认，待实施

---

## 一、定位与目标

P4 是权威代码库，Git 只做本地备份。用户完全感知不到 Git 的存在，只需要关心"我改了什么"和"我要提交到 P4"。

**不是**一个完整的 Git 客户端。复杂的 Git 操作（revert 单次提交、cherry-pick、分支管理、复杂冲突解决）交给命令行或 Fork。

**核心功能**：
- 查看改动文件列表 + diff
- Hunk 级别的单行/段落撤销
- 手动提交快照（里程碑节点）
- P4 Sync（含 Sync 前自动保护）
- 提交到 P4（reconcile → P4V → 确认）
- 时间线查看 + 回滚到某个节点
- 多工作区管理

---

## 二、架构

### 影子仓库模式

每个 P4 Stream 对应一个独立的 Git 仓库，存放在 Electron userData 目录下，通过 Windows Junction 链接到 P4 工作区的受控目录。P4 工作区目录完全不动。

```
%AppData%\Roaming\p4git-tool\
├── ProjectX_dev_git\
│   ├── .git\
│   ├── Source\          ← Junction → <stream.root>\ProjectX\Source
│   └── Content\Script\  ← Junction → <stream.root>\ProjectX\Content\Script
├── ProjectX_release_git\
│   ├── .git\
│   ├── Source\          ← Junction → ...
│   └── Content\Script\  ← Junction → ...
└── p4git.yaml           ← 配置文件
```

### Git 分支结构（用户不可见）

每个仓库只有两条线，对用户完全透明：

- `mirror/p4`：只跟踪 P4 服务器状态，每次 P4 Sync 后通过 git plumbing 命令更新，不切换分支
- `<stream名>`：用户工作线，名字与 P4 stream 一致（如 `dev`、`release`），所有快照都提交到这里

### 文件变更判断基准

改动文件列表 = `git diff --name-only mirror/p4` + 工作区未提交文件。

以 `mirror/p4` 为基准而非上一个 commit，过滤掉 P4 还原产生的假改动，防止 `p4 reconcile` 时出现几百个无意义的变更。

### 通信架构（继承现有）

```
前端 (React)
    ↕ fetch / SSE
Express API（内嵌 Electron 主进程，随机端口）
    ↕ child_process.spawn
p4 / git 命令行工具
```

---

## 三、界面结构

### 整体布局

```
┌─────────────────────────────────────────────────┐
│  ⬡ P4Git │ dev ●3 │ release │ main │ +  │  ↻ ⚙ │  标题栏 + Tab
├──────────────┬──────────────────────────────────┤
│              │                                  │
│  文件列表    │         diff 面板                │
│              │                                  │
│  [提交快照]  │                                  │
│  [提交到P4]  │                                  │
│  [P4 Sync]   │                                  │
├──────────────┴──────────────────────────────────┤
│  ⏱  ──●────●────●────●────●────◉               │  时间线
├─────────────────────────────────────────────────┤
│  📋 操作日志（可折叠，默认收起）                 │
├─────────────────────────────────────────────────┤
│  dev · 快照 14:32 · P4 已连接 · 3 个改动        │  状态栏
└─────────────────────────────────────────────────┘
```

### 各区域说明

**标题栏 + Tab**
- 每个 Tab = 一个 P4 Stream 工作区，Tab 上显示改动文件数角标
- 切换 Tab 即切换工作区，无分支概念暴露给用户
- 右侧：刷新按钮、配置按钮

**文件列表（左侧）**
- 显示相对于 `mirror/p4` 的真实改动文件
- 状态标记：M（修改）、A（新增）、D（删除）
- 右键菜单：还原整个文件
- 底部三个操作按钮：提交快照、提交到 P4、P4 Sync

**Diff 面板（右侧）**
- 点击左侧文件显示具体改动内容
- 行号 + 增删高亮（绿色新增、红色删除）
- 每个 hunk 右上角有 **Discard** 按钮，撤销该段改动
- 每行改动旁有 **Discard line** 按钮，撤销单行

**时间线（底部，可折叠）**
- 横向滚动，默认定位到最右侧（最新节点）
- 节点直接穿在轴线上，视觉连贯
- 悬停节点显示详情气泡（时间、改动文件数、文件名预览）
- 点击历史节点触发回滚确认对话框

**操作日志（底部，默认折叠）**
- 显示后台命令输出（p4 sync、git commit 等）
- 出错时自动展开并高亮错误行

**状态栏**
- 始终可见，显示：当前工作区名、上次快照时间、P4 连接状态、改动文件数

---

## 四、时间线节点类型

| 节点 | 颜色 | 触发方式 | 可回滚 |
|---|---|---|---|
| P4 Sync | 深蓝 `#007acc` | P4 Sync 完成后自动产生 | 是 |
| Sync 前保护 | 浅蓝 `#569cd6` | P4 Sync 执行前自动产生（仅当有未提交改动时） | 是 |
| 手动快照 | 黄色 `#cca700` | 用户点击"提交快照"手动触发 | 是 |
| P4 提交 | 绿色 `#4ec9b0` | 提交到 P4 确认后自动产生 | 是 |
| 当前工作区 | 紫色 `#c586c0` | 始终存在于最右侧 | 否（代表当前状态） |

**无自动备份节点**：不做定时自动 commit，避免产生无意义的噪音节点，也避免 agent 改到一半被自动提交。

---

## 五、核心操作流程

### 提交快照

```
用户点击"提交快照"
→ 弹出输入框填写描述
→ git add -A
→ git commit -m "<描述>"
→ 时间线新增黄色节点
→ 刷新文件列表（应清空，因为已提交）
```

### P4 Sync

```
用户点击"P4 Sync"
→ 检查是否有未提交改动
    → 有：git add -A + git commit -m "sync 前保护" → 时间线新增浅蓝节点
    → 无：跳过
→ p4 sync（按配置的 scope）
→ 更新 mirror/p4（git plumbing，不切换分支）：
    git read-tree mirror/p4
    git add Source/ Content/Script/
    git write-tree → git commit-tree → git update-ref refs/heads/mirror/p4
    git read-tree HEAD（恢复 index）
→ git merge mirror/p4（合并到 main）
→ p4 sync -k（对齐 have 记录，防止假改动）
→ 时间线新增深蓝节点
→ 刷新文件列表
```

### 提交到 P4

```
用户点击"提交到 P4"
→ p4 sync -k（先对齐 have，消除假改动）
→ 检查候选文件（git diff --name-only mirror/p4 HEAD）
→ p4 fstat 检查每个文件是否过期
    → 有过期文件：p4 sync 过期文件 → 更新 mirror/p4 → merge 到 main → 重新检查
→ p4 reconcile 候选文件
→ p4 change -i（通过 stdin 传入 spec）创建 Changelist
→ 打开 P4V
→ 用户在 P4V 完成提交后，回到工具点"确认提交完成"
→ p4 sync 刚提交的文件
→ 更新 mirror/p4
→ merge mirror/p4 → main
→ 时间线新增绿色节点
→ 刷新文件列表
```

### 时间线回滚

```
用户点击某个历史节点
→ 检测到有未提交改动
    → 有：提示"当前有未提交的改动，请先提交快照或还原所有改动，再执行回滚"→ 终止
    → 无：继续
→ 弹出确认对话框（显示节点时间、描述、改动文件数）
→ 确认后：
    git checkout <hash> -- .
    p4 sync -k（对齐 have 记录）
    git add -A + git commit -m "revert to <时间> <描述>"
→ 时间线新增黄色节点（描述为"回滚到 xx:xx"）
→ 刷新文件列表
```

### Hunk 级别撤销

```
用户在 diff 面板点击某个 hunk 的 Discard 按钮
→ 提取该 hunk 的 patch 内容
→ git apply --reverse（反向应用该 hunk）
→ p4 sync -k（对齐 have）
→ 刷新 diff 面板和文件列表

用户点击某行的 Discard line 按钮
→ 构造只包含该行的单行 patch
→ git apply --reverse
→ p4 sync -k
→ 刷新
```

### 还原整个文件（右键菜单）

```
用户右键文件 → "还原此文件"
→ git checkout mirror/p4 -- <filepath>
→ p4 sync -k
→ 刷新文件列表（该文件消失）
```

---

## 六、关键技术决策

### p4 sync -k 作为收尾动作

任何改变工作区文件内容的操作完成后，都必须执行 `p4 sync -k` 对齐 have 记录：

- git checkout 回滚后
- git merge 完成后
- hunk discard 后
- 文件还原后

这是防止 `p4 reconcile` 产生假改动的根本保障，固化在工具内部，用户感知不到。

### 写操作串行化队列

所有写操作（git add、git commit、git checkout、git apply）通过一个 Promise 队列串行执行，防止并发操作导致 `index.lock` 冲突。参考 git-cola 的 `_index_lock` 机制。

```typescript
class WriteQueue {
  private queue = Promise.resolve();
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
}
```

### 文件监听（仅刷新 UI）

使用 `chokidar` 监听 Junction 目录的文件变化，**只用于刷新文件列表 UI**，不触发任何自动 commit。

过滤规则（参考 git-cola fsmonitor 和 VSCode DotGitWatcher）：
- 忽略 `.git/**`（避免死循环）
- 忽略 `Binaries/**`、`Intermediate/**`、`Saved/**`（编译产物）
- 忽略 `*.lock` 文件（git 临时文件）
- 文件变化后防抖 500ms 再刷新

### p4CreateChangelist 修复

现有代码有 bug：构造了 spec 字符串但没有通过 stdin 传给 `p4 change -i`。需要修复 `runner.ts` 支持 stdin 输入，或改用临时文件方式传入 spec。

### ESM/CJS 混用修复

`operations.ts` 第 483 行使用了 `require('js-yaml')`，项目是 ESM（`"type": "module"`），需改为顶部 `import yaml from 'js-yaml'`。

---

## 七、需要重构的范围

### 删除

- `electron/services/operations.ts` 中的 stash 相关函数（`listStashes`、`createStash`、`popStash`、`dropStash`、`parseStashLine`、`stashMsg`）
- `electron/services/operations.ts` 中的 `mergeForward`、`mergeBranchNoSwitch`
- `electron/server.ts` 中的 stash 相关路由
- `src/components/StashPanel.tsx`
- `src/components/ChangesPanel.tsx`（逻辑移入 App.tsx 或新组件）
- `src/store/appStore.ts` 中的 stash 相关状态和 action

### 新增

- `electron/services/watcher.ts`：chokidar 文件监听，SSE 推送 UI 刷新事件
- `electron/services/queue.ts`：写操作串行化队列
- `electron/services/diff.ts`：diff 解析、hunk 提取、patch 构造
- `src/components/Timeline.tsx`：时间线组件
- `src/components/DiffPanel.tsx`：diff 面板，含 hunk/line discard
- `src/components/FileList.tsx`：文件列表，含右键菜单
- 新增 API 路由：`/api/diff`、`/api/discard-hunk`、`/api/discard-file`、`/api/rollback`

### 修复

- `electron/services/p4.ts`：`p4CreateChangelist` 修复 stdin 传入
- `electron/services/operations.ts`：`require('js-yaml')` 改为 ESM import
- `electron/services/operations.ts`：所有文件操作后追加 `p4 sync -k`
- `electron/server.ts`：长操作（pull、submit）响应后不用 setTimeout，改为 SSE 完成事件触发前端刷新

---

## 八、不在本次范围内

- revert 单次提交（git revert）
- cherry-pick
- 分支切换 UI
- 复杂冲突解决 UI
- Git 远程仓库操作
- 自动定时 commit
