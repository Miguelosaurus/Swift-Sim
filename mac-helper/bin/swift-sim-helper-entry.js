#!/usr/bin/env node
import "../src/ownedWorkerPreload.js";
import "../src/helperHttpBoundaryPreload.js";
await import("./swift-sim-helper.js");
