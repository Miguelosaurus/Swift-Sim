#!/usr/bin/env node
import "../src/lockOwnershipPreload.js";
import "../src/ownedWorkerPreload.js";
import "../src/runtimeHealthPreload.js";
import "../src/deviceBuildCapabilityBoundaryPreload.js";
import "../src/helperHttpBoundaryPreload.js";
import { installRenewalShutdownGuard } from "../src/renewalShutdownPreload.js";
import { replaceSwiftSimNodeImport } from "../src/runtimePreloadOptions.js";

const hardenedPreloadURL = new URL("../src/hardenedRuntimePreload.js", import.meta.url).href;
process.env.NODE_OPTIONS = replaceSwiftSimNodeImport(process.env.NODE_OPTIONS, hardenedPreloadURL);
installRenewalShutdownGuard();
await import("./swift-sim-helper.js");
