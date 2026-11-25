import { randomUUID } from "node:crypto";
import { capabilityForTokens, deviceBuildCapabilityExpired } from "./deviceBuildCapability.js";
import { processStartedAt } from "./deviceBuildStore.js";

// A settling budget after the last byte, matching the native install command's
// 180-second budget. This is policy, not an iOS completion guarantee.
export const POST_DOWNLOAD_MS = 180_000;
const processIdentity = pid => { const startToken = processStartedAt(pid); return startToken ? { startToken } : null; };

function streaming(transfer, now, identity) {
  if (transfer?.state !== "streaming" || transfer.deadline <= now) return false;
  try { process.kill(transfer.pid, 0); } catch (error) { if (error.code !== "EPERM") return false; }
  const current = identity(transfer.pid);
  return !current || current.startToken === transfer.startToken;
}
function touch(build) { build.revision = Number(build.revision || 0) + 1; build.updatedAt = new Date().toISOString(); }

// Admission and revocation use the same transaction. A request authorized before
// supersession must revalidate here, before a single IPA byte is sent.
export function admitIPA(store, id, token, { now = Date.now, identity = processIdentity, deviceUDID = null } = {}) {
  const lease = store.withTransaction(state => {
    const build = state.builds.get(id), capability = capabilityForTokens(build, [token]);
    if (!build || build.state !== "ready" || !capability || deviceBuildCapabilityExpired(build, capability, now())) return { status: 410 };
    if (streaming(build.ipaTransfer, now(), identity)) return { status: 409 };
    const owner = identity(process.pid);
    if (!owner) return { status: 503 };
    build.ipaTransfer = { id: randomUUID(), state: "streaming", pid: process.pid, startToken: owner.startToken,
      startedAt: now(), deadline: Date.parse(capability.expiresAt), deviceUDID, completedAt: build.ipaTransfer?.completedAt || 0,
      completedDeviceUDID: build.ipaTransfer?.completedDeviceUDID || null };
    touch(build);
    return { status: 200, ...build.ipaTransfer };
  });
  if (lease.status !== 200) return lease;
  return { status: 200, deadline: lease.deadline, finish: completed => store.withTransaction(state => {
    const build = state.builds.get(id);
    if (build?.ipaTransfer?.id !== lease.id || build.ipaTransfer.state !== "streaming") return;
    build.ipaTransfer.state = completed ? "completed" : "aborted";
    if (completed) {
      build.ipaTransfer.completedAt = now();
      build.ipaTransfer.completedDeviceUDID = lease.deviceUDID;
    }
    touch(build);
  }) };
}

export async function reconcileHandoffs(store, target, { now = Date.now, identity = processIdentity, observe = async () => null, supersede = true } = {}) {
  const candidates = store.list().filter(b => b.id !== target.id
    && b.app?.bundleIdentifier === target.app?.bundleIdentifier && b.app?.teamID === target.app?.teamID
    && (Date.parse(b.createdAt) <= Date.parse(target.createdAt) || b.ipaTransfer));
  for (const old of candidates) {
    let provenAt = 0;
    let provenDevice;
    const recipient = old.ipaTransfer?.completedDeviceUDID || null;
    if (old.ipaTransfer?.completedAt && old.ipaTransfer.completedAt + POST_DOWNLOAD_MS > now()
      && !streaming(old.ipaTransfer, now(), identity)) {
      try {
        const proof = await observe(old, recipient), at = Date.parse(proof?.observedAt);
        if (proof?.state === "installed-version-observed" && proof.deviceUDID && at <= now() + 5000
          && (recipient ? proof.deviceUDID === recipient : proof.soleProfileDevice === true)) {
          provenAt = at || 0;
          provenDevice = proof.deviceUDID;
        }
      } catch { /* The bounded settling window still applies. */ }
    }
    const fence = store.withTransaction(state => {
      const build = state.builds.get(old.id), transfer = build?.ipaTransfer;
      if (!build || build.app?.bundleIdentifier !== target.app?.bundleIdentifier || build.app?.teamID !== target.app?.teamID
        || transfer?.state === "superseded") return null;
      const active = streaming(transfer, now(), identity);
      const deadline = active ? transfer.deadline : (transfer?.completedAt || 0) + POST_DOWNLOAD_MS;
      if (active || (deadline > now() && (provenAt < transfer?.completedAt || old.ipaTransfer?.id !== transfer?.id))) return {
        code: active ? "INSTALL_DOWNLOAD_IN_PROGRESS" : "INSTALL_HANDOFF_PENDING", nextAction: active ? "wait" : "check-status",
        requestId: build.id, resolvesAt: new Date(deadline).toISOString(),
        message: active ? "An earlier IPA is downloading. Wait for it to finish or disconnect."
          : "The earlier download finished. Check inventory or wait until resolvesAt before another install.",
      };
      // Never revoke a newer saved link merely because an older build was selected.
      if (!supersede || Date.parse(build.createdAt) > Date.parse(target.createdAt)) return null;
      build.ipaTransfer = { ...transfer, state: "superseded", supersededBy: target.id,
        ...(provenDevice && provenAt >= transfer?.completedAt && old.ipaTransfer?.id === transfer?.id
          ? { completedDeviceUDID: provenDevice } : {}) };
      build.tokenExpiredAt = new Date(now()).toISOString();
      touch(build);
      return null;
    });
    if (fence) return fence;
  }
  return null;
}
