import path from 'path';
import fs from 'fs';
import { loadConfig, repoPath } from './config';
import { run } from './runner';
import { docsDir } from './docs';

/**
 * 知识库启用时，给工作区 CLAUDE.md 追加的文档产出规则段落。
 * 带真实知识库路径 + 当前分支子目录；未启用返回空字符串。
 */
function docsRuleSection(stream: string): string {
  const dir = docsDir();
  if (!dir) return '';
  return [
    '',
    '',
    '## 文档产出（知识库）',
    `- 所有产出的文档写入知识库：\`${dir}\``,
    `- 技术方案 → \`${dir}\\技术方案\\${stream}\\\``,
    `- Bug 分析/修复 → \`${dir}\\Bug\\${stream}\\\``,
    `- 跨对话上下文 → \`${dir}\\agent上下文\\\``,
    `- 通用规范 → \`${dir}\\知识库\\\``,
    '- 文件名用 `日期-主题.md`，开头带 frontmatter（类型/功能/分支/日期/标签）',
    `- 产出后更新 \`${dir}\\index.md\` 和 \`${dir}\\log.md\``,
    `- 详细规范见 \`${dir}\\CLAUDE.md\``,
  ].join('\n');
}

// -------------------------------------------------------
// 配置模板系统
// 模板真源放在 {workspaces_dir}\.p4git-templates\
// 支持编辑模板 + 一键同步到各工作区
// -------------------------------------------------------

export type TemplateKind = 'gitignore' | 'gitattributes' | 'claudemd' | 'mcp';

// 工具管理区标记：标记区内的内容由模板覆盖，区外用户自定义内容保留
export const MARK_BEGIN = '# ===== P4Git Tool 管理区开始，同步时会覆盖，请勿在区内手动编辑 =====';
export const MARK_END = '# ===== P4Git Tool 管理区结束 =====';
// JSON 文件不能用 # 注释，.mcp.json 整体由工具管理（无标记区，直接覆盖）

interface TemplateMeta {
  kind: TemplateKind;
  /** 模板文件名（在 .p4git-templates 目录下） */
  templateFile: string;
  /** 同步到工作区时的目标文件名（相对仓库根） */
  targetFile: string;
  /** 是否用标记区合并（false = 整体覆盖） */
  useMarker: boolean;
  /** 是否被 Git 追踪（true = 仓库文件，同步后需提交到 dev+mirror/p4） */
  tracked: boolean;
}

export const TEMPLATE_METAS: TemplateMeta[] = [
  // .gitignore/.gitattributes 是被追踪的仓库文件，整体覆盖 + 同步后提交双分支
  { kind: 'gitignore', templateFile: 'gitignore.tmpl', targetFile: '.gitignore', useMarker: false, tracked: true },
  { kind: 'gitattributes', templateFile: 'gitattributes.tmpl', targetFile: '.gitattributes', useMarker: false, tracked: true },
  // CLAUDE.md/.mcp.json 被 .gitignore 忽略，不追踪，写盘即可
  { kind: 'claudemd', templateFile: 'CLAUDE.md.tmpl', targetFile: 'CLAUDE.md', useMarker: true, tracked: false },
  { kind: 'mcp', templateFile: 'mcp.json.tmpl', targetFile: '.mcp.json', useMarker: false, tracked: false },
];

// -------------------------------------------------------
// 默认模板内容（首次运行时生成；从原 writeGitIgnore 等迁移而来）
// -------------------------------------------------------

const DEFAULT_GITIGNORE = [
  '# Unreal Engine build artifacts',
  'Binaries/',
  'Intermediate/',
  'DerivedDataCache/',
  'Saved/',
  '',
  '# Visual Studio',
  '.vs/',
  '*.VC.db',
  '*.VC.opendb',
  '*.suo',
  '*.opensdf',
  '*.user',
  '',
  '# Claude Code',
  '.claude/',
  '# P4Git Tool 下发的 agent 配置，不追踪',
  'CLAUDE.md',
  '.mcp.json',
  '',
  '# Only track Source/ and Content/Script/',
  '# 先忽略 Content 下所有内容，再用 negation 恢复 Script 子目录',
  '/Content/*',
  '!/Content/Script/',
  '# UnLua 自动生成的类型提示，不需要追踪',
  'Content/Script/IntelliSense/',
].join('\n');

const DEFAULT_GITATTRIBUTES =
  '* text=auto eol=lf\n*.lua text eol=lf\n*.cpp text eol=lf\n*.h text eol=lf\n*.cs text eol=lf\n';

const DEFAULT_CLAUDEMD = [
  '# 本工作区由 P4Git Tool 管理',
  '',
  '## 禁止操作',
  '- 不要切换 Git 分支（git checkout / git switch）',
  '- 不要操作 mirror/p4 分支（工具内部维护的镜像）',
  '- 不要 git push（没有远程仓库）',
  '- 不要 git merge（合并由工具的「对齐 Git」处理）',
  '- 不要 p4 submit（P4 提交由用户在 P4V 中完成）',
  '- 不要 p4 sync（同步由工具处理，手动 sync 会导致 reconcile 混乱）',
  '',
  '## 提交快照',
  '- 只 git add 自己本次改过的文件，不要 git add -A（避免和其他 agent 的改动混在一起）',
  '- 提交信息格式：type: 中文描述（type 取 feat/fix/refactor/perf/chore/docs）',
  '',
  '## P4 用户',
  '- P4 用户名以 p4git.yaml 配置为准，不要用 Windows 登录名推断',
].join('\n');

const DEFAULT_MCP = JSON.stringify({ mcpServers: {} }, null, 2);

function defaultContent(kind: TemplateKind): string {
  switch (kind) {
    case 'gitignore': return DEFAULT_GITIGNORE;
    case 'gitattributes': return DEFAULT_GITATTRIBUTES;
    case 'claudemd': return DEFAULT_CLAUDEMD;
    case 'mcp': return DEFAULT_MCP;
  }
}

// -------------------------------------------------------
// 模板目录与读写
// -------------------------------------------------------

export function templatesDir(rootDir: string): string {
  return path.join(rootDir, '.p4git-templates');
}

function metaByKind(kind: TemplateKind): TemplateMeta {
  const m = TEMPLATE_METAS.find(t => t.kind === kind);
  if (!m) throw new Error(`未知模板类型: ${kind}`);
  return m;
}

/** 确保模板目录和默认模板文件存在（缺失则用默认内容生成，不覆盖已有） */
export function ensureTemplates(rootDir: string): void {
  const dir = templatesDir(rootDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'skills'), { recursive: true });
  for (const meta of TEMPLATE_METAS) {
    const f = path.join(dir, meta.templateFile);
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, defaultContent(meta.kind), 'utf-8');
    }
  }
}

/**
 * 在 workspaces_dir 生成「同步配置.bat」，供 agent 调用同步配置到工作区。
 * 依赖工具运行中（POST 到本地 server）。端口默认 3001。
 */
export function writeSyncBat(rootDir: string, port = 3001): void {
  const batPath = path.join(rootDir, '同步配置.bat');
  const content = [
    '@echo off',
    'chcp 65001 >nul',
    'rem 把配置模板(忽略规则/Agent规则/技能/MCP)同步到所有工作区',
    'rem 需要 P4Git Tool 正在运行',
    `curl -s -X POST http://127.0.0.1:${port}/api/sync-config -H "Content-Type: application/json" -d "{}"`,
    'echo.',
    'echo 同步完成（若报错请确认 P4Git Tool 已启动）',
  ].join('\r\n') + '\r\n';
  try {
    fs.writeFileSync(batPath, content, 'utf-8');
  } catch {
    // 生成失败不影响主流程
  }
}

/** 读取单个模板内容 */
export function readTemplate(rootDir: string, kind: TemplateKind): string {
  ensureTemplates(rootDir);
  const meta = metaByKind(kind);
  const f = path.join(templatesDir(rootDir), meta.templateFile);
  try {
    return fs.readFileSync(f, 'utf-8');
  } catch {
    return defaultContent(kind);
  }
}

/** 保存单个模板内容 */
export function writeTemplate(rootDir: string, kind: TemplateKind, content: string): void {
  ensureTemplates(rootDir);
  const meta = metaByKind(kind);
  const f = path.join(templatesDir(rootDir), meta.templateFile);
  fs.writeFileSync(f, content, 'utf-8');
}

/** 读取所有模板 */
export function readAllTemplates(rootDir: string): Record<TemplateKind, string> {
  const result = {} as Record<TemplateKind, string>;
  for (const meta of TEMPLATE_METAS) {
    result[meta.kind] = readTemplate(rootDir, meta.kind);
  }
  return result;
}

// -------------------------------------------------------
// 技能（skills/ 目录下的 .md 文件）
// -------------------------------------------------------

export interface SkillEntry {
  name: string;       // 文件名去掉 .md
  content: string;
}

export function listSkills(rootDir: string): SkillEntry[] {
  ensureTemplates(rootDir);
  const dir = path.join(templatesDir(rootDir), 'skills');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({
      name: f.replace(/\.md$/, ''),
      content: fs.readFileSync(path.join(dir, f), 'utf-8'),
    }));
}

export function writeSkill(rootDir: string, name: string, content: string): void {
  ensureTemplates(rootDir);
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('技能名非法');
  fs.writeFileSync(path.join(templatesDir(rootDir), 'skills', `${safe}.md`), content, 'utf-8');
}

export function deleteSkill(rootDir: string, name: string): void {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
  const f = path.join(templatesDir(rootDir), 'skills', `${safe}.md`);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

// -------------------------------------------------------
// 标记区合并
// -------------------------------------------------------

/**
 * 把模板内容包进标记区，并和工作区现有文件的「区外内容」合并。
 * - 现有文件没有标记区：管理区放最前，原内容整体作为用户区追加在后
 * - 现有文件有标记区：替换标记区内容，保留区外内容
 */
export function mergeWithMarker(templateContent: string, existing: string | null): string {
  const block = `${MARK_BEGIN}\n${templateContent.trimEnd()}\n${MARK_END}`;
  if (existing === null) {
    return block + '\n';
  }
  const beginIdx = existing.indexOf(MARK_BEGIN);
  const endIdx = existing.indexOf(MARK_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx).trimEnd();
    const after = existing.slice(endIdx + MARK_END.length).replace(/^\n/, '');
    const parts = [before, block, after].filter(s => s.trim() !== '');
    return parts.join('\n') + '\n';
  }
  // 现有文件无标记区：管理区在前，原内容作为用户区追加
  const userPart = existing.trim();
  return userPart ? `${block}\n\n${userPart}\n` : block + '\n';
}

// -------------------------------------------------------
// 同步到工作区
// -------------------------------------------------------

export interface SyncFileResult {
  target: string;
  action: 'written' | 'unchanged' | 'skipped';
}

export interface SyncStreamResult {
  stream: string;
  ok: boolean;
  files: SyncFileResult[];
  error?: string;
}

/** 把模板 + 技能同步到单个工作区 */
async function syncStream(rootDir: string, stream: string): Promise<SyncStreamResult> {
  const repo = repoPath(rootDir, stream);
  const files: SyncFileResult[] = [];
  try {
    if (!fs.existsSync(repo)) {
      return { stream, ok: false, files: [], error: '工作区目录不存在，请先 init' };
    }

    const trackedChanged: string[] = [];

    for (const meta of TEMPLATE_METAS) {
      let tmpl = readTemplate(rootDir, meta.kind);
      // CLAUDE.md：若启用知识库，注入文档产出规则（带真实路径 + 当前分支子目录）
      if (meta.kind === 'claudemd') {
        tmpl = tmpl + docsRuleSection(stream);
      }
      const targetPath = path.join(repo, meta.targetFile);
      const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null;
      const next = meta.useMarker ? mergeWithMarker(tmpl, existing) : tmpl.trimEnd() + '\n';
      if (existing === next) {
        files.push({ target: meta.targetFile, action: 'unchanged' });
      } else {
        fs.writeFileSync(targetPath, next, 'utf-8');
        files.push({ target: meta.targetFile, action: 'written' });
        if (meta.tracked) trackedChanged.push(meta.targetFile);
      }
    }

    // 同步技能到 .claude/skills/
    const skills = listSkills(rootDir);
    if (skills.length > 0) {
      const skillsDir = path.join(repo, '.claude', 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });
      for (const s of skills) {
        const targetPath = path.join(skillsDir, `${s.name}.md`);
        const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null;
        if (existing === s.content) {
          files.push({ target: `.claude/skills/${s.name}.md`, action: 'unchanged' });
        } else {
          fs.writeFileSync(targetPath, s.content, 'utf-8');
          files.push({ target: `.claude/skills/${s.name}.md`, action: 'written' });
        }
      }
    }

    // 追踪文件有改动时，提交到 dev + mirror/p4 双分支
    if (trackedChanged.length > 0) {
      await commitTrackedFiles(repo, trackedChanged, stream);
    }

    return { stream, ok: true, files };
  } catch (e: any) {
    return { stream, ok: false, files, error: e.message };
  }
}

/**
 * 把追踪文件(.gitignore/.gitattributes)提交到 dev 和 mirror/p4 双分支。
 * 用 plumbing 命令，不影响工作区其他改动。
 */
async function commitTrackedFiles(repo: string, filePaths: string[], stream: string): Promise<void> {
  const msg = `chore: 更新工具配置文件 (${filePaths.join(', ')})`;

  // 1. 提交到 dev（当前分支）：只 add 这几个文件，部分提交
  await run('git', ['add', '--', ...filePaths], repo, true);
  await run('git', ['commit', '-m', msg, '--', ...filePaths], repo, true);

  // 2. 提交到 mirror/p4：用 plumbing 基于 mirror/p4 HEAD 创建新 commit
  // 思路：读 mirror/p4 的 tree 到索引，把新文件加入索引，write-tree，commit-tree
  const { stdout: mirrorHash } = await run('git', ['rev-parse', 'mirror/p4'], repo, true);
  const mirrorRef = mirrorHash.trim();
  if (!mirrorRef) return;

  // 用临时环境变量 GIT_INDEX_FILE 创建临时索引，避免污染工作区索引
  const tmpIndex = path.join(repo, '.git', 'tmp-sync-index');
  try {
    // 把 mirror/p4 的 tree 读入临时索引
    await run('git', ['read-tree', '--index-output=' + tmpIndex, 'mirror/p4'], repo, true);

    // 把磁盘上的新文件加入临时索引
    for (const fp of filePaths) {
      const { stdout: blobOut } = await run('git', ['hash-object', '-w', fp], repo, true);
      const blobHash = blobOut.trim();
      if (blobHash) {
        // update-index 需要用 GIT_INDEX_FILE 环境变量
        await run('git', [
          '--work-tree=.', 'update-index', '--add', '--cacheinfo', `100644,${blobHash},${fp}`
        ], repo, true);
      }
    }

    // 但上面的 update-index 用的是默认索引... 换一种更安全的方式：
    // 直接基于 dev 的最新 commit（刚提交的，已包含新 .gitignore）取 tree
    const { stdout: devTreeOut } = await run('git', ['rev-parse', 'HEAD^{tree}'], repo, true);
    const devTree = devTreeOut.trim();

    // 基于 dev 的 tree 创建 mirror/p4 的新 commit（这样 mirror/p4 的 .gitignore 和 dev 一致）
    const { stdout: commitOut } = await run(
      'git', ['commit-tree', devTree, '-p', mirrorRef, '-m', msg], repo, true
    );
    const newCommit = commitOut.trim();
    if (newCommit) {
      await run('git', ['update-ref', 'refs/heads/mirror/p4', newCommit], repo, true);
    }
  } finally {
    // 清理临时索引
    try { fs.unlinkSync(tmpIndex); } catch {}
  }

  // 恢复工作区索引到 HEAD（确保 git status 干净）
  await run('git', ['read-tree', 'HEAD'], repo, true);
  await run('git', ['update-index', '--refresh'], repo, true);
}

/** 同步到所有工作区（或指定 stream） */
export async function syncConfig(rootDir: string, onlyStream?: string): Promise<SyncStreamResult[]> {
  const cfg = loadConfig();
  const streams = onlyStream
    ? cfg.streams.filter(s => s.name === onlyStream)
    : cfg.streams;
  const results: SyncStreamResult[] = [];
  for (const s of streams) {
    results.push(await syncStream(rootDir, s.name));
  }
  return results;
}

/**
 * init 首次提交前用：从模板把 .gitignore 和 .gitattributes 写入指定 repo。
 * .gitignore 用标记区包裹，.gitattributes 整体写入。
 */
export function writeInitIgnoreFiles(rootDir: string, repo: string): void {
  ensureTemplates(rootDir);
  const ignoreTmpl = readTemplate(rootDir, 'gitignore');
  fs.writeFileSync(path.join(repo, '.gitignore'), mergeWithMarker(ignoreTmpl, null), 'utf-8');
  const attrTmpl = readTemplate(rootDir, 'gitattributes');
  fs.writeFileSync(path.join(repo, '.gitattributes'), attrTmpl.trimEnd() + '\n', 'utf-8');
}

// -------------------------------------------------------
// 同步状态检测（用于前端显示绿/黄/红）
// -------------------------------------------------------

export type SyncState = 'ok' | 'behind' | 'modified' | 'missing';

export interface StreamSyncStatus {
  stream: string;
  state: SyncState;
}

/**
 * 检测工作区与模板的同步状态：
 * - missing: 工作区目录或目标文件不存在
 * - ok: 管理区内容 = 模板
 * - behind: 管理区内容 ≠ 模板（模板更新了未同步）
 * - modified: 没有标记区但文件存在（用户手动改过/旧格式）
 */
export function syncStatus(rootDir: string): StreamSyncStatus[] {
  const cfg = loadConfig();
  return cfg.streams.map(sc => {
    const repo = repoPath(rootDir, sc.name);
    if (!fs.existsSync(repo)) return { stream: sc.name, state: 'missing' as SyncState };

    let behind = false;
    let modified = false;
    for (const meta of TEMPLATE_METAS) {
      const tmpl = readTemplate(rootDir, meta.kind);
      const targetPath = path.join(repo, meta.targetFile);
      if (!fs.existsSync(targetPath)) { behind = true; continue; }
      const existing = fs.readFileSync(targetPath, 'utf-8');

      if (meta.useMarker) {
        const beginIdx = existing.indexOf(MARK_BEGIN);
        const endIdx = existing.indexOf(MARK_END);
        if (beginIdx === -1 || endIdx === -1) { modified = true; continue; }
        const managed = existing.slice(beginIdx + MARK_BEGIN.length, endIdx).trim();
        if (managed !== tmpl.trim()) behind = true;
      } else {
        if (existing.trimEnd() !== tmpl.trimEnd()) behind = true;
      }
    }

    const state: SyncState = modified ? 'modified' : behind ? 'behind' : 'ok';
    return { stream: sc.name, state };
  });
}
