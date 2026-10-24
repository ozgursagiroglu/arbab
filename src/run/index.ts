export {
  createWorktree,
  discardWorktree,
  ensureIgnored,
  explicitGit,
  holdsGit,
  indexGitlinks,
  isDirty,
  makeGitRunner,
  nodeGit,
  untrustedTree,
  verifyWorktreeGit,
  worktreeStatus,
} from "./git";
export type { DiscardInput, GitRunner, Worktree, WorktreeGitInput, WorktreeInput } from "./git";
export { rebuildWorktree } from "./rebuild";
export type { RebuildInput, Rebuilt } from "./rebuild";
export { DEPENDENCY_MANIFESTS, isDependencyManifest, prepareDependencies, runArgv } from "./deps";
export type { ArgvRunner } from "./deps";
export {
  acquireFromPool,
  acquireSemaphore,
  acquireSlot,
  acquireWriterLock,
  listPoolEntries,
  releaseIfStale,
  releaseSemaphore,
  releaseSlot,
  releaseToPool,
  releaseWriterLock,
  writerLockKey,
} from "./pool";
export type { Alive, Holder } from "./pool";
export { acquireLeases, isPortFree, leaseEnv, releaseLeases } from "./leases";
export type { LeaseRequest, PortProbe } from "./leases";
export { spawnWorker } from "./spawn";
export type { SpawnImpl, SpawnWorkerInput, SpawnedWorker } from "./spawn";
export { descendantsOf, parsePs, readPs, reap, signalTargets, trackDescendants } from "./tree";
export type { ExecText, PsRow, ReapInput } from "./tree";
export { createWatcher, fileRange, fileSize } from "./watch";
export type { Watcher, WatcherInput, WatcherState, WatcherTick } from "./watch";
export { checkpoint } from "./checkpoint";
export type { CheckpointInput } from "./checkpoint";
export { WORKER_TMP_DIR, ensureWorkerTmp, workerTmpPaths } from "./workertmp";
export type { WorkerTmpPaths } from "./workertmp";
export { ARBAB_DIR, ESLINT_MARKER, arbabIgnoreEntries, ensureArbabMarkers } from "./project-files";
