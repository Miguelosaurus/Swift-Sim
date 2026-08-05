#!/usr/bin/env node
import "../src/commandDeadlinePreload.js";
import "../src/asyncCommandGroupPreload.js";
import "../src/atomicLockRemovalPreload.js";
import "../src/lockOwnershipPreload.js";
import "../src/ownedWorkerPreload.js";
import "../src/runtimeHealthPreload.js";
import "../src/deviceBuildCapabilityBoundaryPreload.js";
import "../src/helperHttpBoundaryPreload.js";
import { helperCliCommandIsExtracted } from "../src/helperCliDispatcher.js";
import { helperRunsAsService } from "../src/helperShutdownScope.js";
import { runHelperBootstrap } from "../src/helperEntrypoint.js";
import { installArtifactCleanupBoundary } from "../src/artifactCleanupBoundaryPreload.js";
import { installLiveEngineOwnershipBoundary } from "../src/liveEngineOwnershipPreload.js";
import { installSwiftSimChildRuntimeBoundary } from "../src/swiftSimChildRuntimeBoundary.js";

if (helperRunsAsService()) {
  await import("../src/helperShutdownDeadlinePreload.js");
  const { installRenewalShutdownGuard } = await import("../src/renewalShutdownPreload.js");
  installRenewalShutdownGuard();
}

try {
  await runHelperBootstrap({
    argv: process.argv.slice(2),
    installBoundaries() {
      installArtifactCleanupBoundary();
      installLiveEngineOwnershipBoundary();
      installSwiftSimChildRuntimeBoundary();
    },
    commandIsExtracted: helperCliCommandIsExtracted,
    async loadExtracted() {
      const { runExtractedHelperCommand } = await import("../src/helperCliRuntime.js");
      return runExtractedHelperCommand;
    },
    loadCompatibility: () => import("./swift-sim-helper.js"),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
