import { planCompilerCacheRetention } from "./deviceBuildCompilerCachePolicy.js";

// This service is explicitly invoked after terminal builds or by the operator.
// Construction/inspection never schedules work or drains historical cleanup.
export function createCompilerCacheRetention({
  store,
  artifactDirectory,
  queue,
  references,
  storage,
  withEngineLock,
  rollbackProtectedBuildIDs = /** @type {(() => Set<string>) | undefined} */ (undefined),
  now = () => new Date().toISOString(),
}) {
  const readQueue = () =>
    queue.compilerRetentionSnapshot ? queue.compilerRetentionSnapshot() : queue.pollingSnapshot();
  function authority() {
    const state = store.phase4AuthorityState?.() || { mode: "legacy" };
    const rollbackWindow =
      state.mode === "sqlite-rollback" && typeof rollbackProtectedBuildIDs === "function";
    if (!["legacy", "sqlite-final"].includes(state.mode) && !rollbackWindow)
      throw new Error("Compiler cache cleanup is paused during storage migration or rollback.");
    return JSON.stringify(state);
  }
  function snapshot(queueSnapshot, openPaths = []) {
    const live = references.read();
    return {
      ...live,
      paths: [...(live.paths || []), ...openPaths],
      scopes: [
        ...queueSnapshot.desires.map((item) => item.scope),
        ...queueSnapshot.records
          .filter((item) => !["refreshed", "expired", "superseded", "failed"].includes(item.state))
          .map((item) => item.scope),
      ],
    };
  }
  function plan() {
    const before = authority();
    const refs = snapshot(readQueue());
    const builds = store.list();
    if (authority() !== before)
      throw new Error("Storage authority changed during compiler cache planning.");
    const result = planCompilerCacheRetention({ builds, artifactDirectory, references: refs });
    // During the rollback window, builds in the frozen legacy snapshot keep
    // their caches so a rollback never loses one. Newer builds prune normally.
    const protectedIDs =
      JSON.parse(before).mode === "sqlite-rollback" ? rollbackProtectedBuildIDs() : new Set();
    const candidates = [];
    for (const candidate of result.candidates) {
      if (protectedIDs.has(candidate.buildID)) {
        result.skipped.push({ buildID: candidate.buildID, reasons: ["rollback-snapshot"] });
        continue;
      }
      try {
        const inspected = storage.inspect(
          candidate,
          builds.find((build) => build.id === candidate.buildID)?.liveReload?.compilerCache,
        );
        if (inspected) candidates.push({ ...candidate, ...inspected });
      } catch {
        result.skipped.push({
          buildID: candidate.buildID,
          reasons: ["filesystem-or-worker-unverified"],
        });
      }
    }
    return { ...result, authority: before, candidates };
  }
  async function apply(planned = plan()) {
    if (planned.version !== 1 || planned.dryRun !== true || !Array.isArray(planned.candidates))
      throw new TypeError("Compiler cache cleanup requires a retention plan.");
    const results = [];
    if (planned.candidates.length === 0) return { version: 1, attempted: 0, pruned: 0, results };
    // A bounded one-shot observation; no watcher or collector survives this run.
    let openPaths = await references.openPaths();
    for (const [index, original] of planned.candidates.entries()) {
      let detached;
      try {
        if (index > 0) openPaths = await references.openPaths();
        detached = await withEngineLock(() =>
          queue.withRetentionSnapshot((queueSnapshot) => {
            if (authority() !== planned.authority)
              return { status: "refused", reason: "Storage authority changed." };
            const refs = snapshot(queueSnapshot, openPaths);
            const current = store.get(original.buildID);
            const observed = storage.inspect(original, current?.liveReload?.compilerCache);
            if (
              !observed ||
              JSON.stringify(observed) !==
                JSON.stringify({
                  directoryIdentity: original.directoryIdentity,
                  rootIdentity: original.rootIdentity,
                })
            )
              return { status: "refused", reason: "Compiler cache filesystem identity changed." };
            const claim = store.retireCompilerCache({
              candidate: original,
              phase: "claim",
              references: refs,
              now: now(),
              authorityUnchanged: () => authority() === planned.authority,
            });
            if (claim.status !== "accepted") return claim;
            return store.retireCompilerCache({
              candidate: claim.candidate,
              phase: "detach",
              references: refs,
              now: now(),
              authorityUnchanged: () => authority() === planned.authority,
              detach: () => storage.detach(claim.candidate),
            });
          }),
        );
        if (detached.status !== "accepted") {
          results.push({ buildID: original.buildID, ...detached });
          continue;
        }
        // Expensive recursive deletion runs asynchronously AFTER the fast
        // atomic detach, outside the live-engine and delivery-queue locks.
        await storage.remove(detached.candidate);
        if (authority() !== planned.authority) {
          results.push({ buildID: original.buildID, status: "pruned-pending-metadata" });
          continue;
        }
        const completed = store.retireCompilerCache({
          candidate: detached.candidate,
          phase: "complete",
          references: snapshot(readQueue(), openPaths),
          now: now(),
          authorityUnchanged: () => authority() === planned.authority,
        });
        results.push({
          buildID: original.buildID,
          status: completed.status === "accepted" ? "pruned" : "pruned-pending-metadata",
        });
      } catch {
        // A durable retiring/detached marker survives failures. A later normal
        // terminal build or explicit apply can safely resume this exact inode.
        results.push({ buildID: original.buildID, status: "deferred" });
      }
    }
    return {
      version: 1,
      attempted: results.length,
      pruned: results.filter((item) => item.status.startsWith("pruned")).length,
      results,
    };
  }
  return Object.freeze({
    plan,
    apply,
    async reconcile() {
      return apply(plan());
    },
  });
}
