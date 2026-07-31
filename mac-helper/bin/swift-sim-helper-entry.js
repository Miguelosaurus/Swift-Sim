#!/usr/bin/env node
import "../src/lockOwnershipPreload.js";
import "../src/ownedWorkerPreload.js";
import "../src/runtimeHealthPreload.js";
import "../src/deviceBuildCapabilityBoundaryPreload.js";
import "../src/helperHttpBoundaryPreload.js";
import { installRenewalShutdownGuard } from "../src/renewalShutdownPreload.js";
import { installSwiftSimChildRuntimeBoundary } from "../src/swiftSimChildRuntimeBoundary.js";

installSwiftSimChildRuntimeBoundary();
installRenewalShutdownGuard();
await import("./swift-sim-helper.js");
