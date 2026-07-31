#!/usr/bin/env node
import "../src/lockOwnershipPreload.js";
import "../src/ownedWorkerPreload.js";
import "../src/helperHttpBoundaryPreload.js";
await import("./swift-sim-helper.js");
