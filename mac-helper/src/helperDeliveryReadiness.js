import { inspectRuntimeHealth } from "./runtimeHealth.js";

// One readiness contract for the CLI's delivery and setup/doctor helper check.
// Inspect the original transport rather than the legacy compatibility fetch
// wrapper, which intentionally converts incompatible listeners into HTTP 503.
export async function deliveryRuntimeHealth({ inspect = () => inspectRuntimeHealth(`http://127.0.0.1:${Number(process.env.SWIFT_SIM_PORT || 47217)}/health`) } = {}) {
  const health = await inspect();
  return helperReadinessResult(health);
}

export function helperReadinessResult(health) {
  if (health.ok) return { ok: true, version: health.version, protocol: health.protocol };
  const code = health.failureCode || "HELPER_UNAVAILABLE";
  const message = recoveryMessage(code, health.status);
  return {
    ok: false, userAction: true, code, message,
    diagnostic: {
      code,
      ...(health.cause ? { cause: health.cause } : {}),
    },
  };
}

function recoveryMessage(code, status) {
  switch (code) {
    case "HELPER_TIMEOUT":
      return "The Mac helper health check timed out. Run swift-sim doctor --json, then retry this delivery when the helper responds.";
    case "HELPER_CONNECTION_REFUSED":
      return "The Mac helper is not accepting connections. Run swift-sim setup to start it, then retry this delivery.";
    case "HELPER_IDENTITY_MISMATCH":
      return "Another service answered the helper health check. Run swift-sim doctor --json and resolve the helper listener before retrying.";
    case "HELPER_VERSION_MISMATCH":
      return "The running Mac helper does not match this Swift Sim CLI. Run swift-sim setup to reconcile the installed helper, then retry this delivery.";
    case "PROTOCOL_MISMATCH":
      return "The running Mac helper uses an incompatible protocol. Update Swift Sim and reconcile the helper; start a new agent session if its integration changed.";
    case "HELPER_HTTP_ERROR":
      return `The Mac helper health endpoint returned HTTP ${status}. Run swift-sim doctor --json and retry after the helper recovers.`;
    case "HELPER_RESPONSE_INVALID":
      return "The Mac helper returned an invalid health response. Run swift-sim doctor --json to check the listener before retrying.";
    case "HELPER_UNHEALTHY":
      return "The Mac helper reported it is not ready. Run swift-sim doctor --json and resolve the reported item before retrying.";
    default:
      return "The Mac helper health request failed. Run swift-sim doctor --json to check local helper connectivity, then retry.";
  }
}
