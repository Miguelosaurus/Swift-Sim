import { canonicalProjectPath, projectRootForDescriptor } from "./liveSessionDescriptor.js";
import { isAbsolute, relative, resolve, sep } from "node:path";

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const ACTIONS = new Set([
  "none",
  "wait",
  "open-app",
  "confirm-install",
  "open-swift-sim",
  "check-mac",
  "check-status",
]);
const CODES = new Set([
  "STATUS_UNAVAILABLE",
  "PREPARING",
  "CHANGES_APPLIED",
  "BUILD_INSTALLED",
  "READY_TO_INSTALL",
  "INSTALL_QUEUED",
  "CONFIRM_INSTALL",
  "INSTALL_CONFIRMING",
  "UNCONFIRMED",
  "CHECK_MAC",
  "NEEDS_ATTENTION",
  "EXPIRED",
  "SUPERSEDED",
  "WAITING_FOR_APP",
  "APPLYING",
  "BUILT_IN_XCODE",
  "INSTALL_CANCELLED",
  "MULTIPLE_PENDING",
]);

// An explicit read of the existing feed. Never starts a helper, engine, build,
// control session or install; uncertainty is preserved rather than retried.
export async function readDeliveryStatus({
  appID,
  project,
  workspace,
  scheme,
  cwd = process.cwd(),
  listApps,
  loadPairing,
  fetchFeed = fetchActivityFeed,
} = {}) {
  try {
    if ((project && workspace) || (appID && (!ID.test(appID) || project || workspace || scheme)))
      throw fail("DELIVERY_SCOPE_REQUIRED");
    if (!listApps || !loadPairing) {
      const { createPhase4ProductionStoreFactories } =
        await import("./persistence/phase4ProductionStores.js");
      const stores = createPhase4ProductionStoreFactories({ deviceMaintenance: false });
      listApps ||= () => stores.createDeviceBuildStore().listApps();
      loadPairing ||= () => stores.createPairingStore().load();
    }
    const selected = workspace || project;
    const apps = (await listApps()).filter(
      (app) =>
        ID.test(app.id || "") &&
        (appID
          ? app.id === appID
          : app.builds?.some((build) => {
              try {
                const path = canonicalProjectPath(build.workspace || build.project);
                const child = relative(projectRootForDescriptor(path), resolve(cwd));
                return (
                  (selected
                    ? path === canonicalProjectPath(selected)
                    : !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`)) &&
                  (!scheme || scheme === build.scheme)
                );
              } catch {
                return false;
              }
            })),
    );
    if (apps.length !== 1) throw fail("DELIVERY_SCOPE_REQUIRED");
    const pairing = await loadPairing();
    if (!pairing?.token || !pairing.installationID) throw fail("DELIVERY_PAIRING_REQUIRED");
    const feed = await fetchFeed(pairing);
    if (feed?.installationId !== pairing.installationID) throw fail("DELIVERY_PAIRING_CHANGED");
    if (feed.deliveryStatus?.schemaVersion !== 1) throw fail("DELIVERY_HELPER_UPDATE_REQUIRED");
    const value = feed.deliveryStatus.apps?.[apps[0].id];
    if (!value) throw fail("DELIVERY_STATUS_UNAVAILABLE");
    const presentation = publicDeliveryPresentation(value);
    return { outcome: "delivery-status", appID: apps[0].id, status: presentation };
  } catch (error) {
    const code = Object.hasOwn(GUIDANCE, error?.code) ? error.code : "DELIVERY_STATUS_UNAVAILABLE";
    return {
      outcome: "needs-user-action",
      code,
      message: GUIDANCE[code],
      completionVerified: false,
    };
  }
}
export function publicDeliveryPresentation(v) {
  if (
    v?.schemaVersion !== 1 ||
    !CODES.has(v.code) ||
    !ACTIONS.has(v.nextAction) ||
    typeof v.title !== "string" ||
    !v.title ||
    v.title.length > 160 ||
    typeof v.message !== "string" ||
    v.message.length > 800 ||
    v.completionVerified !== ["BUILD_INSTALLED", "CHANGES_APPLIED"].includes(v.code) ||
    typeof v.updatedAt !== "string" ||
    v.updatedAt.length > 64 ||
    !Number.isFinite(Date.parse(v.updatedAt)) ||
    (v.buildId !== undefined && !ID.test(v.buildId)) ||
    (v.requestId !== undefined && !ID.test(v.requestId)) ||
    (v.revision !== undefined && (!Number.isSafeInteger(v.revision) || v.revision < 1))
  )
    throw fail("DELIVERY_STATUS_UNAVAILABLE");
  return {
    schemaVersion: 1,
    code: v.code,
    title: v.title,
    message: v.message,
    nextAction: v.nextAction,
    completionVerified: v.completionVerified,
    updatedAt: v.updatedAt,
    ...(v.buildId ? { buildId: v.buildId } : {}),
    ...(v.requestId ? { requestId: v.requestId } : {}),
    ...(v.revision ? { revision: v.revision } : {}),
  };
}
async function fetchActivityFeed(pairing) {
  const port = Number(process.env.SWIFT_SIM_PORT || 47217);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw fail("DELIVERY_STATUS_UNAVAILABLE");
  const response = await fetch(`http://127.0.0.1:${port}/api/activity`, {
    headers: { Authorization: `Bearer ${pairing.token}` },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw fail("DELIVERY_STATUS_UNAVAILABLE");
  }
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > 1024 * 1024) throw fail("DELIVERY_STATUS_UNAVAILABLE");
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
function fail(code) {
  return Object.assign(new Error(code), { code });
}
const GUIDANCE = {
  DELIVERY_SCOPE_REQUIRED:
    "Select one registered app with --project/--workspace and --scheme, or --app-id.",
  DELIVERY_PAIRING_REQUIRED: "Pair this Mac in Swift Sim before checking phone delivery.",
  DELIVERY_PAIRING_CHANGED:
    "The Mac pairing changed. Reconnect before checking delivery; no request was sent.",
  DELIVERY_HELPER_UPDATE_REQUIRED:
    "Update the Mac helper to read the shared delivery status. No delivery was retried.",
  DELIVERY_STATUS_UNAVAILABLE:
    "The current delivery status could not be confirmed. Check your Mac before retrying an update.",
};
