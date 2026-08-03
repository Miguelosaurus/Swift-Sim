import { BUILD_STATE_LOCK_TIMEOUT_CODE } from "./deviceBuildStoreCore.js";

export async function runDeliveryCleanupSafely(cleanup, { onError = console.warn } = {}) {
  try {
    await cleanup();
    return { deferred: false };
  } catch (error) {
    if (error?.code === BUILD_STATE_LOCK_TIMEOUT_CODE) {
      return { deferred: true };
    }
    const message = error instanceof Error ? error.message : String(error);
    onError(`Swift Sim delivery-reference cleanup failed: ${message}`);
    return { deferred: false, failed: true };
  }
}
