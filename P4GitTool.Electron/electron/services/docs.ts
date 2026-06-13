import path from 'path';
import fs from 'fs';
import { loadConfig } from './config';

// -------------------------------------------------------
// 知识库（Obsidian vault）骨架管理
// 可选功能：docs_dir 为空 = 不启用；非空 = 启用
// 启用时 init 建骨架（已存在不覆盖），关闭只停写不删文件
// -------------------------------------------------------

/** 知识库是否启用 */
export function docsEnabled(): boolean {
  const cfg = loadConfig();
  return !!(cfg.docs_dir && cfg.docs_dir.trim());
}

/** 知识库根目录，未配置返回空 */
export function docsDir(): string {
  const cfg = loadConfig();
  return cfg.docs_dir?.trim() ?? '';
}

// 骨架文件夹（分类用英文，功能/文档名用中文）
// tech-design、bugs 内部一律按"功能"建子文件夹，这里只建到 dev/release 占位
const SKELETON_DIRS = [
  'tech-design/dev',
  'tech-design/release',
  'bugs/dev',
  'bugs/release',
  'knowledge/工作流',
  'knowledge/引擎',
  'knowledge/项目功能',
  'attachments',
];

const DOCS_CLAUDE_MD = `---
类型: 规范
说明: 本文件定义知识库的组织方式和 agent 写文档的规则
---

# 知识库规范（CLAUDE.md）

> 这是一个 Obsidian 知识库，由 agent 持续维护、人工审阅。
> 设计理念参考 Karpathy 的 LLM-maintained wiki：知识应当沉淀复利，而非每次重新推导。

---

## 一、目录结构与落盘规则

**核心原则：tech-design 和 bugs 内部一律按「功能」建子文件夹，不准把文档平铺在 dev/ 下。**

| 文件夹 | 放什么 | 内部结构 |
|--------|--------|----------|
| \`tech-design/{分支}/{功能}/\` | 功能开发方案、协议、配表、策划原文 | 按功能分文件夹，每个功能夹含一份 \`context.md\` |
| \`bugs/{分支}/{功能}/\` | 问题分析、根因排查、修复方案 | 按功能分文件夹，每个功能夹含一份 \`context.md\` |
| \`knowledge/{工作流|引擎|项目功能}/\` | 通用规范、工具指南、引擎知识 | 按这三类分，不绑定具体功能 |
| \`attachments/\` | 图片、截图 | 平铺 |

**落盘判断**：
- 写功能方案 → \`tech-design/{当前分支}/{功能名}/\`
- 写 bug 分析/修复 → \`bugs/{当前分支}/{功能名}/\`
- 通用规范/指南 → \`knowledge/工作流|引擎|项目功能/\`

**功能文件夹规则**：
- 同一功能在 tech-design 和 bugs 里用**同名文件夹**（如都叫 \`制造系统\`），互不混淆
- 每个功能文件夹里放一份 \`context.md\`：记录做这个功能 / 修这个 bug 的对话记忆，方便多会话接续
- 功能名不存在就新建文件夹

\`{当前分支}\` 由 agent 所在的 P4Git 工作区决定（dev 工作区就写 dev）。

---

## 二、文件命名

1. **不带日期前缀** —— 时间记在 frontmatter 的 \`日期\` 字段，标题只写主题。不要 \`2026-06-13-xxx.md\`
2. **用中文主题名** —— 描述性内容用中文，如 \`新手引导说明.md\`、\`分享系统说明.md\`
3. **接口名/专有名词保留英文** —— 代码里的真实接口名保留英文，如 \`GoodsProgress-API.md\`、\`USDK分享接口文档.md\`（转中文反而搜不到）
4. **不重复功能名** —— 已在功能文件夹下，文件名别再带功能名。用 \`拉新活动/Common数据桶耦合拆分报告.md\`，不要带"拉新活动"前缀
5. **对话记忆固定叫 \`context.md\`** —— 每个功能夹一份

示例：\`制造系统/架构总结.md\`、\`制造系统/任务进度不刷新-修复.md\`、\`分享功能/context.md\`

---

## 三、每篇文档必须带 frontmatter

\`\`\`markdown
---
类型: bug              # 技术方案 / bug / 上下文 / 知识
功能: 制造系统          # 所属功能文件夹名；knowledge 类可省略
分支: dev              # dev / release；knowledge 类可省略
日期: 2026-06-04
标签: [bug, 制造系统, dev]
---
\`\`\`

---

## 四、产出后必须更新 index 和 log

1. 更新 \`index.md\`：对应功能下加一行「\`[[文档名]]\` — 一句话摘要」
2. 追加 \`log.md\`：记一行「日期 + 动作 + 文档 + 简述」

---

## 五、并发安全（多 agent 同时写知识库时必读）

为避免 Edit 工具因"文件被别的 agent 改过"而报错：

1. 自己新建的文档（功能文件夹里那篇）：随便用 Write/Edit，只有你在写，不冲突。
2. 共享文件（\`index.md\`、\`log.md\`）：
   - 优先"追加到末尾"，不要替换整段（log 表格末尾加一行，index 对应小节末尾加一行）
   - 改前先重新 Read 拿最新内容
   - Edit 报错(old_string 不匹配)= 文件刚被别人改了：重新 Read 再追加自己那行
   - 一次只加自己那一行，不大段重写

口诀：自己的文件随便写，共享文件只追加、先重读、报错就重读再追加。

---

## 六、定期 lint（人工触发）

检查孤儿文档、index 失效条目、重复主题、平铺在 dev/ 下没归功能文件夹的文档。
`;

const DOCS_INDEX_MD = `---
类型: 索引
说明: 知识库内容目录，每篇文档一行摘要。agent 产出文档后在此登记。
---

# 知识库索引

> 新增文档后，在对应功能下加一行：\`[[文档名]] — 一句话摘要\`。

## 技术方案 (tech-design)
### dev
<!-- 按功能分组，如：**制造系统** 下列该功能的文档 -->

### release

## Bug (bugs)
### dev

### release

## 知识库 (knowledge)
### 工作流

### 引擎

### 项目功能

## 知识库 / 通用规范 (knowledge)
`;

const DOCS_LOG_MD = `---
类型: 日志
说明: 追加式产出日志。agent 每次产出/修改文档后追加一行。
---

# 产出日志

> 格式：\`YYYY-MM-DD | 动作 | 文档 | 简述\`（动作：新建/更新/合并/删除/lint）

| 日期 | 动作 | 文档 | 简述 |
|------|------|------|------|
`;

const DOCS_README_MD = `# 0 · 请先读我（知识库使用说明）

> 这是一个由 P4Git Tool 管理、agent 持续维护的 Obsidian 知识库。
> **拿到这个库先读这页，再往里放文档。**

---

## 这个库是干嘛的

存放开发过程中产出的所有文档：技术方案、bug 分析、对话上下文、通用规范。
目标是让知识沉淀、可检索、可追溯，而不是散成一堆找不到的 md。

---

## ⚠️ 重要：不要手动乱塞文档

**文档一律让 agent 写**，不要自己随手丢 md 进来。原因：
- agent 会按规范放到正确文件夹、取规范文件名、打好标签、更新索引
- 手动塞的文档没标签、没登记、放错地方，时间一长库就乱了

如果必须手动放，请严格按下面的规则。

---

## 目录怎么分

**核心：tech-design 和 bugs 内部一律按「功能」建子文件夹，不准平铺。**

| 文件夹 | 放什么 |
|--------|--------|
| \`tech-design/{分支}/{功能}/\` | 该功能的技术方案、协议、配表、策划原文 + 一份 \`context.md\` |
| \`bugs/{分支}/{功能}/\` | 该功能的 bug 分析、根因、修复 + 一份 \`context.md\` |
| \`knowledge/{工作流|引擎|项目功能}/\` | 通用规范、工具指南、引擎知识 |
| \`attachments/\` | 图片、截图 |

- 同一功能在 tech-design 和 bugs 用**同名文件夹**（如都叫 \`制造系统\`）
- 每个功能文件夹放一份 \`context.md\`：做这个功能 / 修这个 bug 的对话记忆

---

## 文档怎么命名

- 功能夹内文档用简洁主题名：\`制造系统/架构总结.md\`、\`制造系统/任务进度不刷新-修复.md\`
- 每个功能夹的对话记忆固定叫 \`context.md\`
- \`knowledge/\` 下用简洁主题名，如 \`unlua导出规则.md\`

## 每篇文档开头要带 frontmatter

\`\`\`markdown
---
类型: bug              # 技术方案 / bug / 上下文 / 知识
功能: 制造系统          # 所属功能文件夹名；knowledge 类可省略
分支: dev              # dev / release；knowledge 类可省略
日期: 2026-06-05
标签: [bug, 制造系统, dev]
---
\`\`\`

---

## 怎么查阅

- \`index.md\` — 全部文档目录，按功能分组
- 看某功能全貌 → 打开它的功能文件夹（\`tech-design/dev/制造系统/\` + \`bugs/dev/制造系统/\`）
- \`Ctrl+O\` 快速跳文档，\`Ctrl+Shift+F\` 全文搜索

给 agent 的完整规范见 \`CLAUDE.md\`。
`;

// 各分类文件夹的 _README.md
const FOLDER_READMES: Record<string, string> = {
  'tech-design': `# tech-design · 技术方案

放：功能开发方案、协议文档、配表指南、策划原文。
- 按分支分 \`dev/\`、\`release/\`，**分支下一律按功能建子文件夹**，不准平铺
- 一个功能一个文件夹（如 \`dev/制造系统/\`），夹内含该功能的文档 + 一份 \`context.md\`
- frontmatter 类型: 技术方案
`,
  'bugs': `# bugs · Bug 分析与修复

放：bug 现象记录、根因分析、修复方案。
- 按分支分 \`dev/\`、\`release/\`，**分支下一律按功能建子文件夹**，不准平铺
- 功能文件夹和 tech-design 同名（如都叫 \`制造系统\`），夹内含 bug 文档 + 一份 \`context.md\`
- frontmatter 类型: bug
`,
  'knowledge': `# knowledge · 通用规范

放：通用规范、工具指南、引擎知识，不绑定具体功能。
- 分三类子文件夹：\`工作流/\`、\`引擎/\`、\`项目功能/\`
- 稳定规范可不带日期；frontmatter 类型: 知识
`,
  'attachments': `# attachments · 附件

放：图片、截图等非文本资源。
- Obsidian 粘贴图片默认存这里
- 在文档里用 \`![[图片名.png]]\` 引用
`,
};

/**
 * 确保知识库骨架存在（已存在的文件/目录不覆盖）。
 * 仅在知识库启用（docs_dir 非空）时由 init 调用。
 */
export function ensureDocsSkeleton(dir: string): void {
  if (!dir || !dir.trim()) return;
  const root = dir.trim();
  fs.mkdirSync(root, { recursive: true });
  for (const d of SKELETON_DIRS) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  // 根文件：不存在才写，避免覆盖用户/agent 已有内容
  const files: [string, string][] = [
    ['0-README.md', DOCS_README_MD],
    ['CLAUDE.md', DOCS_CLAUDE_MD],
    ['index.md', DOCS_INDEX_MD],
    ['log.md', DOCS_LOG_MD],
  ];
  for (const [name, content] of files) {
    const f = path.join(root, name);
    if (!fs.existsSync(f)) fs.writeFileSync(f, content, 'utf-8');
  }
  // 各分类文件夹的 _README.md
  for (const [folder, content] of Object.entries(FOLDER_READMES)) {
    const f = path.join(root, folder, '_README.md');
    if (!fs.existsSync(f)) fs.writeFileSync(f, content, 'utf-8');
  }
}
