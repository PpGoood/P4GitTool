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

// 骨架文件夹
const SKELETON_DIRS = [
  'MOC',
  '技术方案/dev',
  '技术方案/release',
  'Bug/dev',
  'Bug/release',
  'agent上下文',
  '知识库',
  '附件',
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
| \`技术方案/\` | 功能开发方案、协议文档、配表指南、策划原文 | 是（dev / release） |
| \`Bug/\` | 问题分析、根因排查、修复方案 | 是（dev / release） |
| \`agent上下文/\` | 跨对话的压缩历史，方便多会话接续 | 否，按时间平铺 |
| \`知识库/\` | 通用规范、工具指南、不绑定具体功能的沉淀 | 否 |
| \`MOC/\` | 聚合页：一个功能/主题一页，用双链汇总相关文档 | 否 |
| \`附件/\` | 图片、截图 | 否 |

**落盘判断**：
- 写功能方案 → \`技术方案/{当前分支}/\`
- 写 bug 分析/修复 → \`Bug/{当前分支}/\`
- 压缩对话历史 → \`agent上下文/\`
- 写通用规范/指南 → \`知识库/\`

\`{当前分支}\` 由 agent 所在的 P4Git 工作区决定（dev 工作区就写 dev）。

---

## 二、文件命名

统一用 \`日期-主题.md\`，日期格式 \`YYYY-MM-DD\`：

\`\`\`
2026-06-04-分享功能图片不显示根因分析.md
\`\`\`

\`知识库/\` 下的稳定规范可不带日期。

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

## 技术方案
### dev

### release

## Bug
### dev

### release

## agent 上下文

## 知识库（通用规范）
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
  // 三个根文件：不存在才写，避免覆盖用户/agent 已有内容
  const files: [string, string][] = [
    ['CLAUDE.md', DOCS_CLAUDE_MD],
    ['index.md', DOCS_INDEX_MD],
    ['log.md', DOCS_LOG_MD],
  ];
  for (const [name, content] of files) {
    const f = path.join(root, name);
    if (!fs.existsSync(f)) fs.writeFileSync(f, content, 'utf-8');
  }
}
