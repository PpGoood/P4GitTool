import path from 'path';
import { loadConfig, repoPath, getStream } from './config';
import { run } from './runner';
import { getQueue } from './queue';
import { LogFn } from './internal';

// -------------------------------------------------------
// 跨工作区同步：把某个快照的 diff 应用到另一个 stream 的 git 仓库
// -------------------------------------------------------

export interface SyncResult {
  ok: boolean;
  applied: number;       // 成功应用的文件数
  conflicts: string[];   // 冲突文件列表
}

/**
 * 把 sourceStream 某个 commit 的改动 patch 到 targetStream 的工作区。
 *
 * 流程：
 * 1. 在 source git 仓生成 patch（git diff parentHash..hash）
 * 2. 在 target git 仓 git apply --3way（三方合并模式，尽量打上，冲突标记）
 * 3. 返回应用结果
 */
export async function syncToStream(
  rootDir: string,
  sourceStream: string,
  hash: string,
  parentHash: string,
  targetStream: string,
  log: LogFn
): Promise<SyncResult> {
  const cfg = loadConfig();
  const srcSc = getStream(cfg, sourceStream);
  const tgtSc = getStream(cfg, targetStream);
  if (!srcSc) { log(`[ERROR] 源 stream '${sourceStream}' 未配置`); return { ok: false, applied: 0, conflicts: [] }; }
  if (!tgtSc) { log(`[ERROR] 目标 stream '${targetStream}' 未配置`); return { ok: false, applied: 0, conflicts: [] }; }

  const srcRepo = repoPath(rootDir, sourceStream);
  const tgtRepo = repoPath(rootDir, targetStream);
  const tgtQueue = getQueue(tgtRepo);

  return tgtQueue.enqueue(async () => {
    // 1. 在源仓库生成 patch
    log(`[INFO] 正在从 ${sourceStream} 导出快照改动...`);
    const diffRef = parentHash ? `${parentHash}..${hash}` : `${hash}~1..${hash}`;
    const { code: diffCode, stdout: patch } = await run(
      'git', ['diff', diffRef], srcRepo, true
    );
    if (diffCode !== 0 || !patch.trim()) {
      log('[ERROR] 无法导出改动 diff（可能是初始 commit 或 hash 无效）');
      return { ok: false, applied: 0, conflicts: [] };
    }

    // 2. 统计 patch 涉及的文件数
    const fileCount = patch.split('\n').filter(l => l.startsWith('diff --git')).length;
    log(`[INFO] 改动包含 ${fileCount} 个文件，正在应用到 ${targetStream}...`);

    // 3. 在目标仓库应用 patch
    // --3way: 冲突时使用三方合并标记而不是直接拒绝
    // --allow-empty: patch 部分已存在时不报错
    const { code: applyCode, stderr: applyErr } = await run(
      'git', ['apply', '--3way', '--whitespace=nowarn'],
      tgtRepo, true, patch  // 通过 stdin 传入 patch 内容
    );

    if (applyCode === 0) {
      log(`[OK] 已成功同步 ${fileCount} 个文件到 ${targetStream} 工作区`);
      return { ok: true, applied: fileCount, conflicts: [] };
    }

    // 部分成功/部分冲突：解析 stderr 找冲突文件
    const conflicts: string[] = [];
    for (const line of applyErr.split('\n')) {
      // "error: patch failed: Source/XGame/Weapon.cpp:42"
      const m = line.match(/error: patch failed: (.+?):/);
      if (m) conflicts.push(m[1]);
    }

    if (conflicts.length > 0 && conflicts.length < fileCount) {
      const applied = fileCount - conflicts.length;
      log(`[WARN] 同步部分成功：${applied} 个文件已应用，${conflicts.length} 个文件有冲突`);
      conflicts.forEach(f => log(`  冲突: ${f}`));
      return { ok: false, applied, conflicts };
    }

    // 全部失败
    log(`[ERROR] 同步失败：${applyErr.split('\n')[0]}`);
    return { ok: false, applied: 0, conflicts };
  });
}
