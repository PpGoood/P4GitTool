# P4GitTool Electron 迁移计划

## 一、目标

将现有 WinForms 桌面应用完全迁移为 Electron 应用，使用已有的 React + TypeScript + Tailwind 前端 UI，保留 C# 后端的所有业务逻辑。

---

## 二、技术架构

### 整体结构

```
P4GitTool.Electron/
├── electron/               ← Electron 主进程（Node.js）
│   ├── main.ts             ← 应用入口，窗口管理
│   ├── server.ts           ← Express HTTP API 服务（内嵌在主进程）
│   ├── preload.ts          ← 安全桥接
│   └── services/           ← 业务逻辑（Node.js 重写）
│       ├── git.ts          ← Git 操作封装
│       ├── p4.ts           ← P4 操作封装
│       ├── operations.ts   ← 核心业务逻辑（对应原 P4GitOperations.cs）
│       ├── config.ts       ← 配置读写
│       └── state.ts        ← 任务状态管理
├── src/                    ← 前端（现有 React 应用迁移过来）
│   ├── App.tsx
│   ├── api/
│   │   └── client.ts       ← 封装所有 HTTP 请求
│   ├── store/
│   │   └── appStore.ts     ← Zustand 全局状态
│   └── components/
│       ├── LogPanel.tsx    ← SSE 日志面板
│       ├── StashPanel.tsx  ← Stash 管理
│       └── ConfigDialog.tsx
├── package.json
└── vite.config.ts
```

### 通信方式

```
前端 (React)
    ↓ fetch / EventSource (SSE)
Express API (内嵌在 Electron 主进程, localhost:随机端口)
    ↓ child_process.spawn
p4 / git 命令行工具
```

**选择内嵌 Express 的原因：**
- 业务逻辑全部用 Node.js 重写，无需 C# 依赖
- Express 内嵌在主进程，打包简单，无需管理子进程
- SSE 日志流天然适合 Express

---

## 三、后端改造（C# → Node.js）

### 服务层对照表

| 原 C# 文件 | 新 Node.js 文件 | 说明 |
|-----------|----------------|------|
| Services/CommandRunner.cs | electron/services/runner.ts | 进程执行封装 |
| Config/P4GitConfig.cs | electron/services/config.ts | 配置读写 |
| App/P4GitOperations.cs | electron/services/operations.ts | 核心业务逻辑 |
| App/P4GitTask.cs | electron/services/state.ts | 任务状态 |
| App/PendingState.cs | electron/services/state.ts | 待提交状态 |
| UI/ (WinForms) | 废弃 | 由前端替代 |

### runner.ts（对应 CommandRunner.cs）

```typescript
export async function run(
  cmd: string, args: string[], cwd?: string
): Promise<{ code: number; stdout: string; stderr: string }>

// 流式执行，每行输出通过回调推送（用于 SSE）
export function runStream(
  cmd: string, args: string[], cwd: string,
  onLine: (line: string) => void
): Promise<number>
```

### operations.ts（对应 P4GitOperations.cs）

迁移所有核心方法：

```typescript
// P4
p4Login()
p4Sync(client, p4root, scope, mode)

// Git
gitCheckClean(repo)
currentBranch(repo)
branchExists(repo, branch)
listBranches(repo)

// 核心流程
init(stream)
pull(stream, scope, mode)
snapshotToMirror(repo, scope, msg)     // 不切换分支更新 mirror/p4
mergeBranchNoSwitch(repo, src, dst)    // 无冲突时不切换分支

// 提交流程
checkAndUpdate(stream)
updateOutdated(stream)
prepareP4Pending(stream)
confirmSubmit(rootDir)

// Git 操作区
getChangedFiles(stream)
commitChanges(stream, message)
listStashes(stream, branch)
createStash(stream, name)
popStash(stream, branch, index)
dropStash(stream, index)
```

### API 端点（Express，内嵌主进程）

```
GET  /api/status?stream=dev         → 工作区状态
GET  /api/config                    → 读取配置
POST /api/config                    → 保存配置

POST /api/init                      → 初始化工作区
POST /api/pull                      → 拉取 P4 最新代码
GET  /api/branches?stream=dev       → 分支列表
POST /api/branch                    → 创建/切换分支

GET  /api/changes?stream=dev        → 改动文件列表
POST /api/snapshot                  → 创建快照
GET  /api/snapshots?stream=dev      → 快照列表

GET  /api/stashes?stream=dev&branch=fix/xxx
POST /api/stash
POST /api/stash/pop
DELETE /api/stash/:index

POST /api/check-update
POST /api/submit-prepare
POST /api/submit-confirm
POST /api/resolve-done

GET  /api/log/stream                → SSE 实时日志
```

---

## 四、前端改造

### 现有 App.tsx 的问题

- 所有数据是 Mock，需要接入真实 API
- 缺少配置页面
- 缺少 Stash 管理 UI
- 缺少日志输出区域

### 需要新增/改造的组件

| 组件 | 说明 |
|------|------|
| `api/client.ts` | 封装所有 HTTP 请求，统一错误处理 |
| `store/appStore.ts` | Zustand 全局状态（stream、branch、changes、stashes） |
| `components/LogPanel.tsx` | 实时日志面板，消费 SSE 流 |
| `components/StashPanel.tsx` | Stash 列表，Pop/Drop 操作 |
| `components/ConfigDialog.tsx` | 配置对话框（P4Port、P4User、Streams） |
| `App.tsx` | 接入真实 API，替换 Mock 数据 |

### 状态管理（Zustand）

```typescript
interface AppState {
  stream: string
  branch: string
  branches: string[]
  changes: FileChange[]
  snapshots: Snapshot[]
  stashes: StashEntry[]
  logs: string[]
  isLoading: boolean
  pendingSubmit: boolean
}
```

---

## 五、Electron 主进程

### 职责

1. 启动 C# 后端子进程（打包后是独立 exe）
2. 等待后端就绪（轮询 /api/status）
3. 创建浏览器窗口，加载前端
4. 应用退出时关闭后端子进程

### 关键逻辑

```typescript
// main.ts
async function startBackend() {
  const port = await getAvailablePort()
  const backendExe = path.join(process.resourcesPath, 'backend', 'P4GitTool.Api.exe')
  backend = spawn(backendExe, ['--port', port])
  await waitForReady(`http://localhost:${port}/api/status`)
  return port
}
```

---

## 六、打包方案

```
electron-builder 打包结果：
├── P4GitTool Setup.exe         ← 安装包
└── resources/
    └── app.asar                ← 前端 + Electron + Node.js 服务全部打包
```

无需额外的 C# 可执行文件，打包更简单。

---

## 七、实施阶段

### 阶段一：项目脚手架搭建（0.5天）

- [ ] 在 `P4GitTool.Electron/` 初始化 Electron + Vite + React + TypeScript 项目
- [ ] 配置 electron-builder
- [ ] 迁移现有 `p4git-modern-tool` 的 src/ 到新项目
- [ ] 确认开发环境可以启动

### 阶段二：Node.js 服务层（2天）

- [ ] `electron/services/runner.ts`：进程执行封装
- [ ] `electron/services/config.ts`：配置读写（YAML）
- [ ] `electron/services/git.ts`：Git 操作（checkout、merge、status 等）
- [ ] `electron/services/p4.ts`：P4 操作（sync、clean、reconcile 等）
- [ ] `electron/services/operations.ts`：核心业务逻辑（Pull、CheckUpdate、Submit 等）
- [ ] `electron/services/state.ts`：任务状态和 pending 状态管理

### 阶段三：Express API 层（1天）

- [ ] `electron/server.ts`：Express 服务，注册所有路由
- [ ] 实现所有 API 端点
- [ ] 实现 SSE 日志流 `/api/log/stream`
- [ ] 用 curl / Postman 测试所有接口

### 阶段四：前端接入（1.5天）

- [ ] `src/api/client.ts`：封装所有 HTTP 请求
- [ ] `src/store/appStore.ts`：Zustand 全局状态
- [ ] `src/components/LogPanel.tsx`：SSE 日志面板
- [ ] `src/components/StashPanel.tsx`：Stash 管理
- [ ] `src/components/ConfigDialog.tsx`：配置对话框
- [ ] 改造 `App.tsx`：替换 Mock 数据，接入真实 API

### 阶段五：Electron 集成与打包（0.5天）

- [ ] `electron/main.ts`：启动 Express 服务，创建窗口
- [ ] `electron/preload.ts`：安全桥接
- [ ] 前后端联调
- [ ] electron-builder 打包测试

---

## 八、待确认的设计问题

~~问题 1：后端语言是否保留 C#？~~ → **不保留，全部用 Node.js 重写**

~~问题 2：前端状态管理用什么？~~ → **Zustand**

~~问题 3：日志实时推送用 SSE 还是 WebSocket？~~ → **SSE**

---

## 九、当前进度

| 阶段 | 状态 |
|------|------|
| 阶段一：项目脚手架搭建 | ✅ 完成 |
| 阶段二：Node.js 服务层 | ✅ 完成 |
| 阶段三：Express API 层 | ✅ 完成 |
| 阶段四：前端接入 | ✅ 完成 |
| 阶段五：Electron 集成与打包 | ✅ 完成 |

