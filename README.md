# P4Git Tool

> 一个把 Perforce(P4)和 Git 桥接起来的桌面工具,让你在 P4 工作流里享受 Git 的本地版本管理能力。

专为大型 Unreal Engine 项目设计:P4 继续负责中心化协作和最终提交,Git 在本地默默记录你的每一步,让你随时回看、对比、回退,而这一切**不影响 P4 的状态**。

---

## 这个工具解决什么问题

P4 擅长管理海量资源和中心化协作,但对写代码的人不够友好:

- **没有本地版本管理** —— 改了一半想精确回退,P4 帮不上忙
- **提交服务器前无法存档** —— 一个功能做几天,中间没法打 checkpoint
- **不利于 AI Agent 协作** —— Agent 改一大批文件后,很难直观看出"这次改了啥、和上个稳定点差在哪"

而这些正是 Git 的强项。P4Git Tool 的思路很简单:

> **本地用 Git 记录,提交走 P4。** 充分利用 Git 的灵活性,同时兼容 P4 的协作方式。

为了降低上手成本,工具**刻意舍弃了 Git 的分支概念**,让你(和 Agent)不用纠结切分支、合分支,专注在 code review 上。

---

## 核心概念

工具内部维护两条 Git 分支:

| 分支 | 含义 |
|------|------|
| **mirror/p4** | P4 状态的镜像。每次从 P4 同步,工具把磁盘当前状态"拍照"存到这条分支,代表"P4 服务器现在是什么样"。 |
| **dev / release / main** | 你的工作分支。手动快照、P4 同步的合并都落在这里,代表"本地现在是什么样"。 |

所有操作本质上都是在维护这两条分支的关系。

**关键设计:** 工具尽量用 Git 的底层命令(plumbing)操作对象库和分支指针,**不切换分支、不改写磁盘文件**,所以不会让 P4 的 reconcile 产生误报。

---

## 主要功能

- **提交快照** —— 给当前改动打本地 checkpoint(`git commit`),只存本地,不推 P4
- **P4 Sync** —— 强制同步(`p4 sync -f`)拉取最新代码,自动记录到时间线;支持按范围同步(全部 / 仅 Lua / 仅 C++)
- **对齐 Git** —— 在 P4V 里手动操作(sync/revert/resolve)后,让 Git 追上磁盘当前状态,以磁盘为准,不做 merge
- **冲突处理** —— 检测到冲突时可选「以 P4 版本覆盖」或「在 Git 中手动解决」,覆盖后展示被覆盖文件列表
- **时间线** —— 可视化所有节点,支持查看历史改动、复制 commit 哈希、筛选手动快照
- **撤销改动** —— 右键还原单个文件到上个快照,或在 VSCode 中打开定位

---

## 技术栈

- **Electron** —— 桌面应用框架
- **Express** —— 内嵌后端,封装 git / p4 命令
- **React 19 + Zustand** —— 前端 UI 与状态管理
- **Tailwind CSS** —— 样式
- **Vite** —— 构建
- **Vitest** —— 测试

后端通过 SSE(Server-Sent Events)把操作日志实时推给前端。

---

## 开发

```bash
cd P4GitTool.Electron
npm install

# 开发模式(热重载)
npm run dev

# 类型检查
npm run lint

# 运行测试
npm test

# 打包(免安装版,输出到 release/win-unpacked)
npm run package:dir

# 打包(NSIS 安装包)
npm run package
```

> 需要本机已安装 `git` 和 `p4` 命令行工具,并配置好 P4 连接。

---

## 目录结构

```
P4GitTool/
├── P4GitTool.Electron/        # 主应用
│   ├── electron/
│   │   ├── routes/            # Express 路由
│   │   └── services/          # 核心逻辑(git/p4 操作、对齐、同步、快照等)
│   ├── src/
│   │   ├── components/        # React 组件
│   │   ├── store/             # Zustand 状态
│   │   └── api/               # 前端 API 客户端
│   └── public/                # 图标等静态资源
└── docs/                      # 设计文档
```

---

## 工作流示例

**日常开发:**
```
写代码 → 提交快照(打 checkpoint) → 继续写 → 再提交快照 → ...
```

**提交到 P4:**
```
P4V 里 reconcile → 有冲突先 resolve → 提交 → 回工具点「对齐 Git」让 Git 跟上
```

**拉取他人代码:**
```
点「P4 Sync」→ 工具自动同步 + 记录到时间线
```

---

## License

MIT
