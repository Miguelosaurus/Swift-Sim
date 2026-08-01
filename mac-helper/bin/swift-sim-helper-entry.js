#!/usr/bin/env node
import "../src/commandDeadlinePreload.js";
import "../src/asyncCommandGroupPreload.js";
import "../src/atomicLockRemovalPreload.js";
import "../src/lockOwnershipPreload.js";
import "../src/ownedWorkerPreload.js";
import "../src/runtimeHealthPreload.js";
import "../src/deviceBuildCapabilityBoundaryPreload.js";
import "../src/helperHttpBoundaryPreload.js";
import { helperRunsAsService } from "../src/helperShutdownScope.js";
import { installArtifactCleanupBoundary } from "../src/artifactCleanupBoundaryPreload.js";
import { installLiveEngineOwnershipBoundary } from "../src/liveEngineOwnershipPreload.js";
import { installSwiftSimChildRuntimeBoundary } from "../src/swiftSimChildRuntimeBoundary.js";

if (helperRunsAsService()) {
  await import("../src/helperShutdownDeadlinePreload.js");
  const { installRenewalShutdownGuard } = await import("../src/renewalShutdownPreload.js");
  installRenewalShutdownGuard();
}
installArtifactCleanupBoundary();
installLiveEngineOwnershipBoundary();
installSwiftSimChildRuntimeBoundary();
await import("./swift-sim-helper.js");
