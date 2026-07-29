from pathlib import Path


def replace(path, old, new):
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    file.write_text(text.replace(old, new))


replace(
    "mac-helper/src/deviceBuildStore.js",
    '''          incoming.token = pending.token;
          incoming.tokenExpiredAt = "";
          incoming.expiresAt = pending.target.expiresAt;
          incoming.remoteBaseUrl = incoming.remoteBaseUrl || pending.target.remoteBaseUrl;
          delete incoming.pendingRenewal;''',
    '''          incoming.token = pending.token;
          incoming.tokenExpiredAt = "";
          incoming.installTTLMinutes = pending.target.ttlMinutes;
          incoming.remoteBaseUrl = incoming.remoteBaseUrl || pending.target.remoteBaseUrl;
          delete incoming.pendingRenewal;''',
)

replace(
    "mac-helper/src/deviceDelivery.js",
    '''function recordedDeliveryProcessesAlive(state) {
  return deliveryIdentities(state).some((identity) => processGroupIsAlive(identity.pid))
    || legacyDeliveryPIDs(state).some(processIsAlive);
}

function recordedDeliveryProcessesExited(state) {
  return deliveryIdentities(state).every((identity) => !processGroupIsAlive(identity.pid))
    && legacyDeliveryPIDs(state).every((pid) => !processIsAlive(pid));
}''',
    '''function recordedDeliveryProcessesAlive(state) {
  return deliveryIdentities(state).some(recordedIdentityIsAlive)
    || legacyDeliveryPIDs(state).some(processIsAlive);
}

function recordedDeliveryProcessesExited(state) {
  return deliveryIdentities(state).every((identity) => !recordedIdentityIsAlive(identity))
    && legacyDeliveryPIDs(state).every((pid) => !processIsAlive(pid));
}

function recordedIdentityIsAlive(identity) {
  if (!identity) return false;
  return processIdentityMatches(identity)
    ? processGroupIsAlive(identity.pid)
    : processIsAlive(identity.pid);
}''',
)

replace(
    "mac-helper/src/deviceDelivery.js",
    '''    ...identities
      .filter((identity) => processGroupIsAlive(identity.pid))
      .map((identity) => ({
        pid: Number(identity.pid),
        ownershipVerified: processIdentityMatches(identity),
        processGroupAlive: true,
      })),''',
    '''    ...identities
      .filter(recordedIdentityIsAlive)
      .map((identity) => ({
        pid: Number(identity.pid),
        ownershipVerified: processIdentityMatches(identity),
        processGroupAlive: processGroupIsAlive(identity.pid),
      })),''',
)

replace(
    "test/deviceBuildStore.test.js",
    '''  assert.ok(active.pendingRenewal?.id);
  assert.notEqual(candidate.expiresAt, oldExpiry);''',
    '''  assert.ok(active.pendingRenewal?.id);
  assert.equal(candidate.expiresAt, "");
  assert.equal(candidate.installTTLMinutes, 60);''',
)

replace(
    "test/deviceBuildStore.test.js",
    '''  renewed.remoteBaseUrl = "https://new-link.example.com";
  renewed.delivery.expiresAt = renewed.expiresAt;
  store.save(renewed);''',
    '''  renewed.remoteBaseUrl = "https://new-link.example.com";
  renewed.expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  renewed.delivery.expiresAt = new Date(Date.now() + 70 * 60_000).toISOString();
  store.save(renewed);''',
)

replace(
    "test/deviceBuildStore.test.js",
    '''  successful.remoteBaseUrl = "https://new-link.example.com";
  successful.delivery.expiresAt = successful.expiresAt;
  store.save(successful);''',
    '''  successful.remoteBaseUrl = "https://new-link.example.com";
  successful.expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  successful.delivery.expiresAt = new Date(Date.now() + 70 * 60_000).toISOString();
  store.save(successful);''',
)
