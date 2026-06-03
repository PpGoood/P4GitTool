import path from 'path';
import fs from 'fs';
import { loadConfig, repoPath } from './config';

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
}

export const TEMPLATE_METAS: TemplateMeta[] = [
  { kind: 'gitignore', templateFile: 'gitignore.tmpl', targetFile: '.gitignore', useMarker: true },
  { kind: 'gitattributes', templateFile: 'gitattributes.tmpl', targetFile: '.gitattributes', useMarker: false },
  { kind: 'claudemd', templateFile: 'CLAUDE.md.tmpl', targetFile: 'CLAUDE.md', useMarker: true },
  { kind: 'mcp', templateFile: 'mcp.json.tmpl', targetFile: '.mcp.json', useMarker: false },
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
function syncStream(rootDir: string, stream: string): SyncStreamResult {
  const repo = repoPath(rootDir, stream);
  const files: SyncFileResult[] = [];
  try {
    if (!fs.existsSync(repo)) {
      return { stream, ok: false, files: [], error: '工作区目录不存在，请先 init' };
    }

    for (const meta of TEMPLATE_METAS) {
      const tmpl = readTemplate(rootDir, meta.kind);
      const targetPath = path.join(repo, meta.targetFile);
      const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null;
      const next = meta.useMarker ? mergeWithMarker(tmpl, existing) : tmpl.trimEnd() + '\n';
      if (existing === next) {
        files.push({ target: meta.targetFile, action: 'unchanged' });
      } else {
        fs.writeFileSync(targetPath, next, 'utf-8');
        files.push({ target: meta.targetFile, action: 'written' });
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

    return { stream, ok: true, files };
  } catch (e: any) {
    return { stream, ok: false, files, error: e.message };
  }
}

/** 同步到所有工作区（或指定 stream） */
export function syncConfig(rootDir: string, onlyStream?: string): SyncStreamResult[] {
  const cfg = loadConfig();
  const streams = onlyStream
    ? cfg.streams.filter(s => s.name === onlyStream)
    : cfg.streams;
  return streams.map(s => syncStream(rootDir, s.name));
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
