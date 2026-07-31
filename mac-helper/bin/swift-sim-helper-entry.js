#!/usr/bin/env node
import "../src/lockOwnershipPreload.js";
import "../src/ownedWorkerPreload.js";
import "../src/deviceBuildCapabilityBoundaryPreload.js";
import "../src/helperHttpBoundaryPreload.js";
import { installRenewalShutdownGuard } from "../src/renewalShutdownPreload.js";

installRenewalShutdownGuard();
await import("./swift-sim-helper.js");
