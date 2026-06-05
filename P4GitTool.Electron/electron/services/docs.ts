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

// 骨架文件夹（分类用英文，文档名用中文）
const SKELETON_DIRS = [
  'MOC',
  'tech-design/dev',
  'tech-design/release',
  'bugs/dev',
  'bugs/release',
  'agent-context',
  'knowledge',
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

| 文件夹 | 放什么 | 是否按分支分 |
|--------|--------|--------------|
| \`tech-design/\` | 功能开发方案、协议文档、配表指南、策划原文 | 是（dev / release） |
| \`bugs/\` | 问题分析、根因排查、修复方案 | 是（dev / release） |
| \`agent-context/\` | 跨对话的压缩历史，方便多会话接续 | 否，按时间平铺 |
| \`knowledge/\` | 通用规范、工具指南、不绑定具体功能的沉淀 | 否 |
| \`MOC/\` | 聚合页：一个功能/主题一页，用双链汇总相关文档 | 否 |
| \`attachments/\` | 图片、截图 | 否 |

**落盘判断**（分类目录用英文，文档名用中文）：
- 写功能方案 → \`tech-design/{当前分支}/\`
- 写 bug 分析/修复 → \`bugs/{当前分支}/\`
- 压缩对话历史 → \`agent-context/\`
- 写通用规范/指南 → \`knowledge/\`

\`{当前分支}\` 由 agent 所在的 P4Git 工作区决定（dev 工作区就写 dev）。

---

## 二、文件命名

统一用 \`日期-主题.md\`，日期格式 \`YYYY-MM-DD\`：

\`\`\`
2026-06-04-分享功能图片不显示根因分析.md
\`\`\`

\`knowledge/\` 下的稳定规范可不带日期。

---

## 三、每篇文档必须带 frontmatter

\`\`\`markdown
---
类型: bug              # 技术方案 / bug / 上下文 / 知识
功能: 分享功能          # 关联的功能名；通用知识可省略
分支: dev              # dev / release；不分支的可省略
日期: 2026-06-04
标签: [bug, 分享功能, dev]
---
\`\`\`

正文里用双链关联：\`关联：[[分享功能]]\`（链回 MOC 页）。

---

## 四、MOC 聚合页

每个功能建一个 MOC 页（放 \`MOC/\`），用双链把该功能的所有文档串起来。
写文档时若属于某功能，去对应 MOC 页加链接；MOC 不存在就新建。

---

## 五、产出后必须更新 index 和 log

1. 更新 \`index.md\`：对应分类下加一行「\`[[文档名]]\` — 一句话摘要」
2. 追加 \`log.md\`：记一行「日期 + 动作 + 文档 + 简述」

---

## 六、定期 lint（人工触发）

检查孤儿文档、MOC 死链、index 失效条目、重复主题。
`;

const DOCS_INDEX_MD = `---
类型: 索引
说明: 知识库内容目录，每篇文档一行摘要。agent 产出文档后在此登记。
---

# 知识库索引

> 新增文档后，在对应分类下加一行：\`[[文档名]] — 一句话摘要\`。

## MOC 聚合页

## 技术方案 (tech-design)
### dev

### release

## Bug (bugs)
### dev

### release

## agent 上下文 (agent-context)

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

## 目录怎么分（分类用英文，文档名用中文）

| 文件夹 | 放什么 | 按分支分? |
|--------|--------|-----------|
| \`tech-design/\` | 技术方案、协议文档、配表指南、策划原文 | 是（dev / release） |
| \`bugs/\` | bug 分析、根因排查、修复方案 | 是（dev / release） |
| \`agent-context/\` | 跨对话的压缩历史，方便多会话接续 | 否，按时间平铺 |
| \`knowledge/\` | 通用规范、工具指南、不绑定具体功能的沉淀 | 否 |
| \`MOC/\` | 聚合页：一个功能一页，用双链汇总该功能所有文档 | 否 |
| \`attachments/\` | 图片、截图 | 否 |

---

## 文档怎么命名

- 文件名用**中文**，格式 \`日期-主题.md\`，如 \`2026-06-05-分享功能图片不显示.md\`
- \`knowledge/\` 下的稳定规范可不带日期

## 每篇文档开头要带 frontmatter

\`\`\`markdown
---
类型: bug              # 技术方案 / bug / 上下文 / 知识
功能: 分享功能          # 关联的功能名；通用知识可省略
分支: dev              # dev / release；不分支的可省略
日期: 2026-06-05
标签: [bug, 分享功能, dev]
---
\`\`\`

正文里用双链关联：\`关联：[[分享功能]]\`（链回该功能的 MOC 页）。

---

## 怎么查阅

- \`index.md\` — 全部文档目录，一句话摘要
- \`MOC/某功能.md\` — 某功能的全貌（技术方案+bug+上下文串在一页）
- \`Ctrl+O\` 快速跳文档，\`Ctrl+Shift+F\` 全文搜索

给 agent 的完整规范见 \`CLAUDE.md\`。
`;

// 各分类文件夹的 _README.md
const FOLDER_READMES: Record<string, string> = {
  'tech-design': `# tech-design · 技术方案

放：功能开发方案、协议文档、配表指南、策划原文。
- 按分支分子目录：\`dev/\`、\`release/\`
- 一个功能建一个子文件夹，聚合该功能的多个相关文档
- 文件名中文，格式 \`日期-主题.md\`，开头带 frontmatter（类型: 技术方案）
`,
  'bugs': `# bugs · Bug 分析与修复

放：bug 现象记录、根因分析、修复方案。
- 按分支分子目录：\`dev/\`、\`release/\`
- 文件名中文，格式 \`日期-主题.md\`，开头带 frontmatter（类型: bug）
- 关联到对应功能的 MOC 页：\`关联：[[功能名]]\`
`,
  'agent-context': `# agent-context · 对话上下文

放：跨对话的压缩历史，方便多会话接续。
- 不按分支分，按时间平铺
- 长对话压缩存档，下次新开对话先让 agent 读这篇接续上下文
- 文件名中文，格式 \`日期-主题.md\`，开头带 frontmatter（类型: 上下文）
`,
  'knowledge': `# knowledge · 通用规范

放：通用规范、工具指南、不绑定具体功能/分支的沉淀。
- 不按分支分，稳定规范可不带日期
- 开头带 frontmatter（类型: 知识）
`,
  'MOC': `# MOC · 内容地图（聚合页）

放：每个功能一个聚合页，用双链把该功能散在各文件夹的文档串起来。
- 一个功能一页，用 \`[[双链]]\` 链向技术方案、bug、上下文
- 看功能全貌时打开这一页即可，不用翻多个文件夹
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
