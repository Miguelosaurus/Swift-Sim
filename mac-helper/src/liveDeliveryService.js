import { createLiveDeliveryQueue } from "./liveDeliveryQueue.js";
import { createLiveDeliveryRuntime } from "./liveDeliveryRuntime.js";
import { createLiveDeliveryAdapter } from "./liveDeliveryAdapter.js";
import { liveRuntimeLockManager } from "./liveEngineLifecycleLock.js";

let service;
export function liveDeliveryService() {
  service ||= createLiveDeliveryRuntime({
    queue: createLiveDeliveryQueue({ lockManager: liveRuntimeLockManager }),
    adapter: createLiveDeliveryAdapter(),
  });
  return service;
}
