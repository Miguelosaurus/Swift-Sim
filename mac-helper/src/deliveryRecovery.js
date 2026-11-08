import { canonicalProjectPath } from "./liveSessionDescriptor.js";

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const PENDING = new Set([
  "queued",
  "compiling",
  "waiting-for-device",
  "waiting-for-foreground",
  "applying",
  "applied",
  "uncertain",
]);
const BUSY = new Set(["compiling", "applying", "applied"]);

// One explicit failure-recovery attempt. This module cannot submit, compile,
// install, apply, clear receipts or change a source snapshot.
export async function recoverDelivery(input = {}, ports) {
  const repaired = [];
  let selected;
  const result = (code, message, nextAction = "check-mac", complete = false) => ({
    schemaVersion: 1,
    outcome: "recovery-status",
    code,
    message,
    nextAction,
    completionVerified: complete,
    repaired: [...repaired],
    ...(selected ? { requestId: selected.requestId } : {}),
  });
  try {
    const validID = typeof input.requestId === "string" && ID.test(input.requestId);
    if (
      (input.workspace && input.project) ||
      (input.requestId ? !validID : !(input.project || input.workspace) || !input.scheme)
    )
      return result(
        "RECOVERY_SCOPE_REQUIRED",
        "Select the existing request, or its exact project and scheme.",
      );
    if (!ports) throw new TypeError("Recovery requires explicit lifecycle ports.");
    return await ports.exclusive(async () => {
      const project = input.workspace || input.project;
      if (
        (input.workspace && input.project) ||
        (input.requestId ? !ID.test(input.requestId) : !project || !input.scheme)
      )
        return result(
          "RECOVERY_SCOPE_REQUIRED",
          "Select the existing request, or its exact project and scheme.",
        );
      const records = () => ports.queue.pollingSnapshot().records;
      const matches = (record) =>
        (!project || canonicalProjectPath(project) === record.scope.project) &&
        (!input.scheme || input.scheme === record.scope.scheme);
      if (input.requestId) selected = ports.queue.get(input.requestId);
      else {
        const candidates = records().filter(
          (record) => matches(record) && PENDING.has(record.state),
        );
        if (candidates.length > 1)
          return result(
            "RECOVERY_SCOPE_REQUIRED",
            "More than one request is pending. Select the existing request ID.",
          );
        selected = candidates[0];
      }
      if ((input.requestId && !selected) || (selected && !matches(selected)))
        return result(
          "RECOVERY_SCOPE_REQUIRED",
          "The request does not match the selected project and scheme.",
        );
      const status = () => (selected ? ports.status(selected.requestId) : null);
      const readinessCode = (value) => {
        const current = selected && ports.queue.get(selected.requestId);
        return (
          value?.delivery?.readiness?.code ||
          (current?.state === "uncertain" ? ports.queue.readiness?.(current)?.code : undefined)
        );
      };
      const terminal = (value) => {
        if (value?.outcome === "hot-reloaded")
          return result(
            "CHANGES_APPLIED",
            "The existing request is confirmed applied and refreshed.",
            "none",
            true,
          );
        if (value && value.outcome !== "queued")
          return result(
            "RECOVERY_PRESERVED",
            "The existing request is terminal or unconfirmed. Inspect its status before creating another delivery.",
            "check-status",
          );
        return null;
      };
      const done = selected?.state === "uncertain" ? null : terminal(status());
      if (done) return done;
      const assertIdle = (startingHelper = false) => {
        if (
          ports.buildsBusy() ||
          (!startingHelper && records().some((r) => BUSY.has(r.state) || r.claim))
        )
          throw fail("RECOVERY_BUSY");
        if (selected) {
          const current = ports.queue.get(selected.requestId);
          if (
            !current ||
            current.snapshotDigest !== selected.snapshotDigest ||
            JSON.stringify(current.scope) !== JSON.stringify(selected.scope) ||
            !PENDING.has(current.state)
          )
            throw fail("RECOVERY_CHANGED");
        }
      };
      let health = await ports.health();
      const code = readinessCode(status());
      const staleWorker =
        health.ok && ["LIVE_WORKER_UNAVAILABLE", "LIVE_ENGINE_OBSERVATION_STALE"].includes(code);
      const restart =
        staleWorker ||
        (health.failureCode === "HELPER_VERSION_MISMATCH" &&
          health.helper === "swift-sim-helper" &&
          health.protocol === 1);
      const start = health.failureCode === "HELPER_CONNECTION_REFUSED";
      if (start || restart) {
        assertIdle(start);
        // The adapter rechecks busy state immediately before lifecycle mutation.
        await ports.repairHelper({ restart, guard: () => assertIdle(start) });
        repaired.push(restart ? "helper-restarted" : "helper-started");
        health = await ports.health();
      }
      if (!health.ok)
        return result(
          "RECOVERY_HELPER_UNCONFIRMED",
          "The Mac helper could not be verified. Inspect the existing listener before restarting anything else.",
        );
      if (!selected)
        return result(
          "RECOVERY_READY",
          "The helper is ready. No existing request was submitted or retried.",
          "continue-edit",
        );
      const currentStatus = status();
      const readiness = readinessCode(currentStatus);
      // After a full Mac restart an uncertain native effect stays fenced, but
      // its receipt still needs the stopped engine restored. Starting that
      // verified session never grants permission to retransmit the patch.
      const receiptOnly =
        currentStatus?.outcome === "failed" &&
        ports.queue.get(selected.requestId)?.state === "uncertain" &&
        readiness === "LIVE_ENGINE_UNAVAILABLE";
      const final = terminal(currentStatus);
      if (final && !receiptOnly) return final;
      if (["LIVE_ENGINE_UNAVAILABLE"].includes(readiness)) {
        assertIdle();
        await ports.restoreStoppedEngine(selected, assertIdle);
        repaired.push("engine-started");
        return result(
          "RECOVERY_RESUMING",
          receiptOnly
            ? "The matching Mac session was restored to check this request's native receipt without applying it again."
            : "The matching Mac session was restored. The existing request will continue through its normal worker.",
          "wait",
        );
      }
      if (
        [
          "LIVE_CAPTURE_MISMATCH",
          "LIVE_CAPTURE_UNAVAILABLE",
          "LIVE_COMPILER_CONTEXT_UNAVAILABLE",
        ].includes(readiness)
      )
        return result(
          "RECOVERY_CHECK_BUILD",
          "Restore the matching saved Debug build context on the Mac. The existing request is preserved.",
        );
      if (["LIVE_ENGINE_UPDATE_REQUIRED", "LIVE_CLIENT_UPDATE_REQUIRED"].includes(readiness))
        return result(
          "RECOVERY_MATCH_COMPONENTS",
          "Align the engine and Debug SDK with this request. No update or rebuild was started.",
        );
      if (readiness === "LIVE_SIGNING_UNAVAILABLE")
        return result(
          "RECOVERY_CHECK_SIGNING",
          "Restore the matching Mac signing access. The existing request is preserved.",
        );
      if (readiness === "LIVE_TARGET_APP_MISMATCH")
        return result(
          "RECOVERY_OPEN_MATCHING_APP",
          "Open the matching installed Debug app on your iPhone.",
          "open-app",
        );
      if (currentStatus.delivery?.normalWaiting && currentStatus.delivery.prepared)
        return result(
          "RECOVERY_WAITING_FOR_APP",
          "Open the matching Debug app on your iPhone when ready. The queued update will continue automatically.",
          "open-app",
        );
      if (
        ["LIVE_READY", "LIVE_PREPARING", "LIVE_READINESS_CHECKING"].includes(readiness) ||
        !readiness ||
        repaired.length
      )
        return result(
          "RECOVERY_RESUMING",
          "The existing request is continuing. Its original identity and snapshots are preserved.",
          "wait",
        );
      return result(
        "RECOVERY_CHECK_MAC",
        "The Mac has not confirmed recovery. Inspect the existing request; do not submit it again.",
      );
    });
  } catch (error) {
    const observedCode = ["SWIFT_SIM_LIVE_ENGINE_BUSY", "SWIFT_SIM_LOCK_BUSY"].includes(error?.code)
      ? "RECOVERY_BUSY"
      : error?.code;
    const code = [
      "RECOVERY_BUSY",
      "RECOVERY_CHANGED",
      "RECOVERY_ENGINE_ACTIVE",
      "RECOVERY_NETWORK_REQUIRED",
      "RECOVERY_COMPONENT_REQUIRED",
      "RECOVERY_BUILD_CONTEXT_REQUIRED",
    ].includes(observedCode)
      ? observedCode
      : "RECOVERY_UNCONFIRMED";
    return result(
      code,
      code === "RECOVERY_BUSY"
        ? "Another build or delivery is active. Let it finish; the existing request is preserved."
        : code === "RECOVERY_NETWORK_REQUIRED"
          ? "Connect this Mac to its existing private Tailscale network, then check this request."
          : "Recovery could not safely change the Mac session. Inspect the existing request; its data and receipts were preserved.",
      code === "RECOVERY_BUSY" ? "wait" : "check-mac",
    );
  }
}
function fail(code) {
  return Object.assign(new Error(code), { code });
}
