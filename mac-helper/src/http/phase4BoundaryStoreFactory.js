// @ts-check

import { join } from "node:path";
import { homedir } from "node:os";
import { createPhase4ProductionStoreFactories } from "../persistence/phase4ProductionStores.js";

/**
 * Shared seam for the helper HTTP capability boundaries. Both preloads must
 * route every reachable pairing/invitation/device-build operation through the
 * one product-global Phase-4 authority selector. The factory is created lazily
 * so importing the boundaries never opens state.sqlite or constructs legacy
 * stores; only an actual HTTP request initializes the durable stores.
 */
export function createBoundaryProductionStoreFactory(options = {}) {
  return createPhase4ProductionStoreFactories({
    ...options,
    deviceMaintenance: false,
  });
}

export function defaultBoundaryStateRoot() {
  return join(homedir(), ".swift-sim");
}
