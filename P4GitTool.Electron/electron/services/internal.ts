import path from 'path';
import fs from 'fs';
import * as git from './git';
import { run } from './runner';

export type LogFn = (line: string) => void;

// -------------------------------------------------------
// scope 映射
// -------------------------------------------------------

export function scopePaths(scope: string): string[] {
  switch (scope) {
    case 'cpp': return ['Source/...'];
    case 'lua': return ['Content/Script/...'];
    case 'all': return ['Source/...', 'Content/Script/...'];
    case 'project': return ['...'];
    default: return [];
  }
}

function scopeTargets(scope: string): string[] {
  switch (scope) {
    case 'cpp': return ['Source'];
    case 'lua': return ['Content/Script'];
    case 'all': return ['Source', 'Content/Script'];
    case 'project': return ['Source', 'Content', 'Config'];
    default: return [];
  }
}

// -------------------------------------------------------
// Tag
// -------------------------------------------------------

export async function gitTag(repo: string, prefix: string): Promise<void> {
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace('T', '-');
  const tag = `${prefix}-${ts}`;
  await run('git', ['tag', tag], repo, true);
}

// -------------------------------------------------------
// 快照到 mirror/p4（不切换分支）
// -------------------------------------------------------

export async function snapshotToMirror(
  repo: string, scope: string, commitMsg: string, log: LogFn
): Promise<boolean> {
  if (!await git.readTree(repo, 'mirror/p4')) {
    log('[ERROR] git read-tree mirror/p4 失败'); return false;
  }

  await git.gitAdd(repo, scopeTargets(scope));

  const { stdout: statusOut } = await run('git', ['status', '--porcelain'], repo, true);
  if (!statusOut.trim()) {
    log('[INFO] P4 无新变更');
    await run('git', ['read-tree', 'HEAD'], repo, true);
    return true;
  }

  const treeHash = await git.writeTree(repo);
  if (!treeHash) { log('[ERROR] git write-tree 失败'); return false; }

  const mirrorHash = await git.revParse(repo, 'mirror/p4');
  if (!mirrorHash) { log('[ERROR] 无法获取 mirror/p4 HEAD'); return false; }

  const commitHash = await git.commitTree(repo, treeHash, mirrorHash, commitMsg);
  if (!commitHash) { log('[ERROR] git commit-tree 失败'); return false; }

  if (!await git.updateRef(repo, 'mirror/p4', commitHash)) {
    log('[ERROR] 更新 mirror/p4 引用失败'); return false;
  }

  await run('git', ['read-tree', 'HEAD'], repo, true);
  log('[OK] P4 快照已更新');
  return true;
}

// -------------------------------------------------------
// init 辅助
// -------------------------------------------------------

export function writeGitIgnore(repo: string) {
  fs.writeFileSync(path.join(repo, '.gitignore'), [
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
    '# Only track Source/ and Content/Script/',
    '# Everything else is ignored by default',
    'Content/',
    '!Content/Script/',
    '!Content/Script/**',
    '',
  ].join('\n'));
}

export function writeGitAttributes(repo: string) {
  fs.writeFileSync(path.join(repo, '.gitattributes'),
    '* text=auto eol=lf\n*.lua text eol=lf\n*.cpp text eol=lf\n*.h text eol=lf\n*.cs text eol=lf\n');
}

export async function ensureJunction(repo: string, linkRel: string, target: string, log: LogFn) {
  const linkPath = path.join(repo, linkRel);
  if (!fs.existsSync(target)) {
    log(`[WARN] Junction 目标不存在，跳过: ${target}`);
    return;
  }
  if (fs.existsSync(linkPath)) {
    log(`[OK] Junction 已存在: ${linkRel}`);
    return;
  }
  try {
    // 用 Node.js 原生 API 创建 Junction，不依赖 cmd.exe
    fs.symlinkSync(target, linkPath, 'junction');
    log(`[OK] Junction 已创建: ${linkRel} -> ${target}`);
  } catch (e: any) {
    log(`[ERROR] Junction 创建失败: ${linkRel} -> ${target}: ${e.message}`);
  }
}
