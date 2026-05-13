/**
 * operations 是按职责拆分后的 barrel 入口，保持 routes 的 import 路径不变。
 * 新代码请直接引用拆分后的模块：
 *   - workspace.ts：init、getStreamStatus
 *   - pull.ts：pull
 *   - submit.ts：buildCandidates、checkOutdated、checkAndUpdate、submitPrepare、confirmSubmit
 *   - align.ts：alignGit、alignGitContinue
 *   - snapshot.ts：commitSnapshot、listSnapshots、SnapshotKind/SnapshotEntry
 *   - changes.ts：getChangedFiles、commitChanges、getSnapshots、getFileDiff、ChangedFile
 *   - history.ts：checkoutHistoryNode、returnToLatest、getNodeFiles、getNodeFileDiff
 *   - discard.ts：discardFile、discardHunk、discardLine
 *   - internal.ts：LogFn、snapshotToMirror、scopePaths/scopeTargets、gitTag 等共享工具
 */

export type { LogFn } from './internal';
export { snapshotToMirror } from './internal';

export { init, getStreamStatus } from './workspace';
export { pull } from './pull';
export {
  buildCandidates, checkOutdated, checkAndUpdate,
  submitPrepare, confirmSubmit,
} from './submit';
export { alignGit, alignGitContinue } from './align';
export {
  commitSnapshot, listSnapshots,
} from './snapshot';
export type { SnapshotKind, SnapshotEntry } from './snapshot';
export {
  getChangedFiles, getFileDiff,
} from './changes';
export type { ChangedFile } from './changes';
export {
  checkoutHistoryNode, returnToLatest, getNodeFiles, getNodeFileDiff,
} from './history';
export { discardFile, discardHunk, discardLine } from './discard';
