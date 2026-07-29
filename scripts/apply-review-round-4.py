from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}\n---OLD---\n{old[:500]}")
    p.write_text(text.replace(old, new, 1))


def replace_count(path, old, new, expected):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{path}: expected {expected} matches, found {count}\n---OLD---\n{old[:500]}")
    p.write_text(text.replace(old, new))


def insert_before(path, marker, content):
    replace_once(path, marker, content + marker)


def write(path, content):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)

# 1/2: transactional pairing, including first-pair staging and same-Mac replacement.
app = "Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift"
replace_once(app, "private enum PairingCredentialVault {", "enum PairingCredentialVault {")
replace_once(app,
'''    private static let pendingAccountKey = "pairedMacPendingCredentialAccount"\n    private static let service = "dev.local.SwiftSimCompanion.pairing"''',
'''    private static let pendingAccountKey = "pairedMacPendingCredentialAccount"\n    private static let pendingPairingIDKey = "pairedMacPendingPairingID"\n    private static let service = "dev.local.SwiftSimCompanion.pairing"''')
replace_once(app,
'''        let expectedAccount = account(for: id)\n        if let storedAccount = account(fromMarker: stored) {\n            discardAbandonedPendingAccount(except: storedAccount)\n            guard storedAccount == expectedAccount,\n                  readToken(account: storedAccount)?.isEmpty == false else {\n                defaults.removeObject(forKey: defaultsKey)\n                cleanupWithoutMetadata()\n                return\n            }\n            reconcileCommittedAccount(expectedAccount)\n            return\n        }''',
'''        let expectedLegacyAccount = account(for: id)\n        if let storedAccount = account(fromMarker: stored) {\n            discardAbandonedPendingAccount(except: storedAccount)\n            guard accountIsAllowed(storedAccount, pairingID: id, legacyExpected: expectedLegacyAccount),\n                  readToken(account: storedAccount)?.isEmpty == false else {\n                defaults.removeObject(forKey: defaultsKey)\n                cleanupWithoutMetadata()\n                return\n            }\n            reconcileCommittedAccount(storedAccount)\n            return\n        }''')
replace_once(app, "storeToken(token, account: expectedAccount)", "storeToken(token, account: expectedLegacyAccount)")
replace_count(app, "object[\"token\"] = marker(for: expectedAccount)", "object[\"token\"] = marker(for: expectedLegacyAccount)", 2)
replace_count(app, "reconcileCommittedAccount(expectedAccount)", "reconcileCommittedAccount(expectedLegacyAccount)", 2)
replace_once(app, "storeToken(stored, account: expectedAccount)", "storeToken(stored, account: expectedLegacyAccount)")
replace_once(app,
'''            guard UserDefaults.standard.data(forKey: defaultsKey) != nil else {\n                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {\n                    if UserDefaults.standard.data(forKey: defaultsKey) == nil {\n                        cleanupWithoutMetadata()\n                    }\n                }\n                return\n            }''',
'''            guard UserDefaults.standard.data(forKey: defaultsKey) != nil else {\n                if UserDefaults.standard.string(forKey: pendingAccountKey) != nil { return }\n                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {\n                    if UserDefaults.standard.data(forKey: defaultsKey) == nil,\n                       UserDefaults.standard.string(forKey: pendingAccountKey) == nil {\n                        cleanupWithoutMetadata()\n                    }\n                }\n                return\n            }''')
replace_once(app,
'''    static func stagePairing(token: String, pairingID: String) -> Bool {\n        let stagedAccount = account(for: pairingID)\n        guard !token.isEmpty, storeToken(token, account: stagedAccount) else { return false }\n        let defaults = UserDefaults.standard\n        if let previousPending = defaults.string(forKey: pendingAccountKey), previousPending != stagedAccount {\n            deleteToken(account: previousPending)\n        }\n        defaults.set(stagedAccount, forKey: pendingAccountKey)\n        return true\n    }\n\n    static func cancelStagedPairing(pairingID: String) {\n        let stagedAccount = account(for: pairingID)\n        let defaults = UserDefaults.standard\n        guard defaults.string(forKey: pendingAccountKey) == stagedAccount else { return }\n        if defaults.string(forKey: committedAccountKey) != stagedAccount {\n            deleteToken(account: stagedAccount)\n        }\n        defaults.removeObject(forKey: pendingAccountKey)\n    }''',
'''    static func stagePairing(token: String, pairingID: String) -> Bool {\n        let stagedAccount = stagingAccount(for: pairingID)\n        guard !token.isEmpty, storeToken(token, account: stagedAccount) else { return false }\n        let defaults = UserDefaults.standard\n        if let previousPending = defaults.string(forKey: pendingAccountKey), previousPending != stagedAccount {\n            deleteToken(account: previousPending)\n        }\n        defaults.set(stagedAccount, forKey: pendingAccountKey)\n        defaults.set(pairingID, forKey: pendingPairingIDKey)\n        return true\n    }\n\n    static func cancelStagedPairing(pairingID: String) {\n        let defaults = UserDefaults.standard\n        guard defaults.string(forKey: pendingPairingIDKey) == pairingID,\n              let stagedAccount = defaults.string(forKey: pendingAccountKey) else { return }\n        if defaults.string(forKey: committedAccountKey) != stagedAccount {\n            deleteToken(account: stagedAccount)\n        }\n        defaults.removeObject(forKey: pendingAccountKey)\n        defaults.removeObject(forKey: pendingPairingIDKey)\n    }''')
replace_once(app,
'''        if let storedAccount = account(fromMarker: storedValue) {\n            guard storedAccount == expectedAccount,\n                  let token = readToken(account: storedAccount), !token.isEmpty else {''',
'''        if let storedAccount = account(fromMarker: storedValue) {\n            guard accountIsAllowed(storedAccount, pairingID: pairingID, legacyExpected: expectedAccount),\n                  let token = readToken(account: storedAccount), !token.isEmpty else {''')
replace_once(app,
'''        let tokenAccount = account(for: pairingID)\n        let defaults = UserDefaults.standard\n        if defaults.string(forKey: pendingAccountKey) == tokenAccount {\n            return marker(for: tokenAccount)\n        }\n        guard !token.isEmpty, storeToken(token, account: tokenAccount) else {\n            throw credentialError("The pairing credential could not be protected in Keychain.")\n        }\n        defaults.set(tokenAccount, forKey: pendingAccountKey)\n        return marker(for: tokenAccount)''',
'''        let defaults = UserDefaults.standard\n        if defaults.string(forKey: pendingPairingIDKey) == pairingID,\n           let pendingAccount = defaults.string(forKey: pendingAccountKey),\n           readToken(account: pendingAccount) == token {\n            return marker(for: pendingAccount)\n        }\n        let tokenAccount = account(for: pairingID)\n        guard !token.isEmpty, storeToken(token, account: tokenAccount) else {\n            throw credentialError("The pairing credential could not be protected in Keychain.")\n        }\n        defaults.set(tokenAccount, forKey: pendingAccountKey)\n        defaults.set(pairingID, forKey: pendingPairingIDKey)\n        return marker(for: tokenAccount)''')
replace_once(app,
'''        if pendingAccount != nil {\n            defaults.removeObject(forKey: pendingAccountKey)\n        }''',
'''        if pendingAccount != nil {\n            defaults.removeObject(forKey: pendingAccountKey)\n            defaults.removeObject(forKey: pendingPairingIDKey)\n        }''')
replace_once(app,
'''        deleteToken(account: pendingAccount)\n        defaults.removeObject(forKey: pendingAccountKey)''',
'''        deleteToken(account: pendingAccount)\n        defaults.removeObject(forKey: pendingAccountKey)\n        defaults.removeObject(forKey: pendingPairingIDKey)''')
replace_once(app,
'''        if defaults.object(forKey: pendingAccountKey) != nil {\n            defaults.removeObject(forKey: pendingAccountKey)\n        }''',
'''        if defaults.object(forKey: pendingAccountKey) != nil {\n            defaults.removeObject(forKey: pendingAccountKey)\n        }\n        if defaults.object(forKey: pendingPairingIDKey) != nil {\n            defaults.removeObject(forKey: pendingPairingIDKey)\n        }''')
insert_before(app,
'''    private static func pairedMacObject() -> [String: Any]? {''',
'''    private static func stagingAccount(for pairingID: String) -> String {\n        "paired-mac-token.pending.\\(Data(pairingID.utf8).base64EncodedString()).\\(UUID().uuidString)"\n    }\n\n    private static func accountIsAllowed(_ candidate: String, pairingID: String, legacyExpected: String) -> Bool {\n        let defaults = UserDefaults.standard\n        if candidate == defaults.string(forKey: committedAccountKey) { return true }\n        if candidate == defaults.string(forKey: pendingAccountKey),\n           pairingID == defaults.string(forKey: pendingPairingIDKey) { return true }\n        return candidate == legacyExpected\n    }\n\n''')

session = "Companion/SwiftSimCompanion/SessionStore.swift"
replace_once(session,
'''        if let pairing = PairedMac(url: url) {\n            pairedMac = pairing\n            savePairedMac()\n            helperStatus = .checking\n            Task { await refreshHelperStatus() }\n            return true\n        }''',
'''        if let pairing = PairedMac(url: url) {\n            let previousPairing = pairedMac\n            pairedMac = pairing\n            guard savePairedMac() else {\n                pairedMac = previousPairing\n                return false\n            }\n            helperStatus = .checking\n            Task { await refreshHelperStatus() }\n            return true\n        }''')
replace_once(session,
'''    private func savePairedMac() {\n        guard let pairedMac,\n              let data = try? JSONEncoder().encode(pairedMac) else { return }\n        UserDefaults.standard.set(data, forKey: pairedMacKey)\n    }''',
'''    @discardableResult\n    private func savePairedMac() -> Bool {\n        guard let pairedMac,\n              let data = try? JSONEncoder().encode(pairedMac) else { return false }\n        UserDefaults.standard.set(data, forKey: pairedMacKey)\n        return UserDefaults.standard.data(forKey: pairedMacKey) == data\n    }''')

store = "mac-helper/src/deviceBuildStore.js"
replace_once(store, 'import { join } from "node:path";', 'import { dirname, join } from "node:path";')
replace_once(store,
'''    build.project = project;\n    build.workspace = workspace;\n    return this.save(build);''',
'''    build.project = project;\n    build.workspace = workspace;\n    const artifactRoot = join(dirname(this.path), "device-builds", build.id);\n    build.artifacts = { ...(build.artifacts || {}), root: artifactRoot };\n    build.control = { ...(build.control || {}), cancelPath: join(artifactRoot, ".cancelled") };\n    return this.save(build);''')
replace_once(store,
'''      const existing = state.builds.get(build.id);\n      if (!existing) return build;''',
'''      const existing = state.builds.get(build.id);\n      if (!existing) {\n        const error = new Error("Device build was cancelled or deleted.");\n        error.code = "SWIFT_SIM_BUILD_CANCELLED";\n        throw error;\n      }''')
replace_once(store,
'''      for (const build of app.builds) {\n        if (deleteArtifacts && build.artifacts?.root) {\n          const delay = ACTIVE_BUILD_STATES.has(build.state) ? ACTIVE_BUILD_CLEANUP_DELAY_MS : 0;''',
'''      for (const build of app.builds) {\n        const active = ACTIVE_BUILD_STATES.has(build.state);\n        if (active && build.control?.cancelPath) {\n          mkdirSync(dirname(build.control.cancelPath), { recursive: true, mode: 0o700 });\n          writeFileSync(build.control.cancelPath, JSON.stringify({\n            buildId: build.id,\n            cancelledAt: new Date(now).toISOString(),\n          }), { mode: 0o600 });\n        }\n        if (deleteArtifacts && build.artifacts?.root) {\n          const delay = active ? ACTIVE_BUILD_CLEANUP_DELAY_MS : 0;''')
replace_once(store,
'''      pid: process.pid,\n      startedAt: processStartedAt(process.pid),''',
'''      pid: process.pid,\n      startedAt: requiredProcessStartedAt(process.pid),''')
insert_before(store,
'''function processStartedAt(pid) {''',
'''function requiredProcessStartedAt(pid) {\n  for (let attempt = 0; attempt < 3; attempt += 1) {\n    const startedAt = processStartedAt(pid);\n    if (startedAt) return startedAt;\n    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);\n  }\n  throw new Error("Unable to establish a process start identity for the Swift Sim build-state lock.");\n}\n\n''')

core_store = "mac-helper/src/deviceBuildStoreCore.js"
replace_once(core_store,
'''      expiresAt: new Date(Date.now() + normalizeDeviceBuildTTLMinutes(input.ttlMinutes) * 60 * 1000).toISOString(),\n      state: "queued",''',
'''      installTTLMinutes: normalizeDeviceBuildTTLMinutes(input.ttlMinutes),\n      expiresAt: "",\n      state: "queued",''')

builder = "mac-helper/src/deviceBuilder.js"
replace_once(builder,
'''    await runRequiredBuildValidation({\n      project: build.project || "",\n      workspace: build.workspace || "",\n    });''',
'''    await runRequiredBuildValidation({\n      project: build.project || "",\n      workspace: build.workspace || "",\n      cancelPath: build.control?.cancelPath || "",\n    });''')
replace_once(builder,
'''  } catch (error) {\n    if (build.state === "validating") {''',
'''  } catch (error) {\n    if (error?.code === "SWIFT_SIM_BUILD_CANCELLED") throw error;\n    if (build.state === "validating") {''')

validation = "mac-helper/src/buildValidation.js"
replace_once(validation,
'''  preferences,\n  timeoutMs,\n} = {}) {''',
'''  preferences,\n  timeoutMs,\n  cancelPath = "",\n} = {}) {''')
replace_once(validation,
'''  await runValidationCommand(command, {\n    cwd: projectDirectory,\n    timeoutMs: effectiveTimeoutMs,\n  });''',
'''  await runValidationCommand(command, {\n    cwd: projectDirectory,\n    timeoutMs: effectiveTimeoutMs,\n    cancelPath,\n  });''')
replace_once(validation,
'''function runValidationCommand(command, { cwd, timeoutMs }) {''',
'''function runValidationCommand(command, { cwd, timeoutMs, cancelPath = "" }) {''')
replace_once(validation,
'''    let forceTimer;\n    let finalTimer;''',
'''    let forceTimer;\n    let finalTimer;\n    let cancellationTimer;''')
replace_once(validation,
'''      clearTimeout(forceTimer);\n      clearTimeout(finalTimer);''',
'''      clearTimeout(forceTimer);\n      clearTimeout(finalTimer);\n      clearInterval(cancellationTimer);''')
replace_once(validation,
'''    timeoutTimer.unref?.();\n\n    child.once("error", (error) => {''',
'''    timeoutTimer.unref?.();\n\n    if (cancelPath) {\n      cancellationTimer = setInterval(() => {\n        if (!existsSync(cancelPath) || settled) return;\n        timedOut = true;\n        signalGroup("SIGTERM");\n        forceTimer = setTimeout(() => signalGroup("SIGKILL"), 2_000);\n        forceTimer.unref?.();\n        finalTimer = setTimeout(() => {\n          const error = validationError("Device build was cancelled while validation was running.");\n          error.code = "SWIFT_SIM_BUILD_CANCELLED";\n          finish(error);\n        }, 4_000);\n        finalTimer.unref?.();\n      }, 100);\n      cancellationTimer.unref?.();\n    }\n\n    child.once("error", (error) => {''')
replace_once(validation,
'''      if (timedOut) {\n        finish(validationError(\n          `Required validation timed out after ${Math.ceil(timeoutMs / 1_000)} seconds; device build cancelled.`\n        ));\n        return;\n      }''',
'''      if (timedOut) {\n        if (cancelPath && existsSync(cancelPath)) {\n          const error = validationError("Device build was cancelled while validation was running.");\n          error.code = "SWIFT_SIM_BUILD_CANCELLED";\n          finish(error);\n        } else {\n          finish(validationError(\n            `Required validation timed out after ${Math.ceil(timeoutMs / 1_000)} seconds; device build cancelled.`\n          ));\n        }\n        return;\n      }''')

builder_core = "mac-helper/src/deviceBuilderCore.js"
replace_once(builder_core,
'''    const root = join(homedir(), ".swift-sim", "device-builds", build.id);''',
'''    throwIfBuildCancelled(build);\n    const root = build.artifacts?.root || join(homedir(), ".swift-sim", "device-builds", build.id);''')
replace_once(builder_core,
'''async function runLogged(command, args, log, { env = process.env } = {}) {\n  const result = await runBuffered(command, args, {\n    onLine: log,\n    timeoutMs: 30 * 60 * 1000,\n    env,\n  });''',
'''async function runLogged(command, args, log, { env = process.env, build } = {}) {\n  const result = await runBuffered(command, args, {\n    onLine: log,\n    timeoutMs: 30 * 60 * 1000,\n    env,\n    cancelPath: build?.control?.cancelPath || "",\n  });''')
text = Path(builder_core).read_text()
text = text.replace('''      ], log, {\n        env: {\n          ...process.env,\n          INJECTION_HOST: liveSession.host,\n        },\n      });''', '''      ], log, {\n        env: {\n          ...process.env,\n          INJECTION_HOST: liveSession.host,\n        },\n        build,\n      });''')
text = text.replace('''      "archive",\n    ], log);''', '''      "archive",\n    ], log, { build });''')
text = text.replace('''      ...(build.allowProvisioningUpdates ? ["-allowProvisioningUpdates"] : []),\n    ], log);''', '''      ...(build.allowProvisioningUpdates ? ["-allowProvisioningUpdates"] : []),\n    ], log, { build });''')
Path(builder_core).write_text(text)
replace_once(builder_core,
'''export function runBuffered(command, args, { onLine, timeoutMs = 120_000, env = process.env } = {}) {''',
'''export function runBuffered(command, args, { onLine, timeoutMs = 120_000, env = process.env, cancelPath = "" } = {}) {''')
replace_once(builder_core,
'''    let settled = false;\n    let timedOut = false;''',
'''    let settled = false;\n    let timedOut = false;\n    let cancellationTimer;''')
replace_once(builder_core,
'''      clearTimeout(timer);''',
'''      clearTimeout(timer);\n      clearInterval(cancellationTimer);''')
replace_once(builder_core,
'''    const timer = setTimeout(() => {''',
'''    if (cancelPath) {\n      cancellationTimer = setInterval(() => {\n        if (!existsSync(cancelPath) || settled) return;\n        timedOut = true;\n        void terminateProcessGroup(child.pid, 2_000).then(() => {\n          const error = new DeviceBuildError("Device build was cancelled.");\n          error.code = "SWIFT_SIM_BUILD_CANCELLED";\n          finish({ code: null, stdout, stderr, error: error.message, cancellationError: error });\n        });\n      }, 100);\n      cancellationTimer.unref?.();\n    }\n\n    const timer = setTimeout(() => {''')
replace_once(builder_core,
'''    child.stdout.on("data", (chunk) => {\n      stdout += chunk;''',
'''    child.stdout.on("data", (chunk) => {\n      stdout = appendBoundedOutput(stdout, chunk.toString("utf8"));''')
replace_once(builder_core,
'''    child.stderr.on("data", (chunk) => {\n      stderr += chunk;''',
'''    child.stderr.on("data", (chunk) => {\n      stderr = appendBoundedOutput(stderr, chunk.toString("utf8"));''')
replace_once(builder_core,
'''  if (result.code !== 0) {\n    throw new DeviceBuildError(result.error || result.stderr || result.stdout || `${command} failed with exit code ${result.code}`);\n  }''',
'''  if (result.cancellationError) throw result.cancellationError;\n  if (result.code !== 0) {\n    throw new DeviceBuildError(result.error || result.stderr || result.stdout || `${command} failed with exit code ${result.code}`);\n  }''')
replace_once(builder_core,
'''  } catch (error) {\n    build.state = "failed";''',
'''  } catch (error) {\n    if (error?.code === "SWIFT_SIM_BUILD_CANCELLED") throw error;\n    build.state = "failed";''')
insert_before(builder_core,
'''function exportOptionsPlist(build) {''',
'''function throwIfBuildCancelled(build) {\n  if (!build.control?.cancelPath || !existsSync(build.control.cancelPath)) return;\n  const error = new DeviceBuildError("Device build was cancelled.");\n  error.code = "SWIFT_SIM_BUILD_CANCELLED";\n  throw error;\n}\n\nfunction appendBoundedOutput(current, addition, maxCharacters = 1_000_000) {\n  const combined = current + addition;\n  return combined.length <= maxCharacters ? combined : combined.slice(-maxCharacters);\n}\n\n''')

helper = "mac-helper/bin/swift-sim-helper.js"
replace_once(helper,
'''import { createReadStream, existsSync, statSync } from "node:fs";''',
'''import { existsSync } from "node:fs";''')
replace_once(helper,
'''import { buildCompanionLinks, buildPairingLinks, codexSession, publicSession } from "../src/links.js";''',
'''import { buildCompanionLinks, buildPairingLinks, codexSession, publicSession } from "../src/links.js";\nimport { serveFile } from "../src/fileServer.js";\nimport { normalizeDeviceBuildTTLMinutes } from "../src/deviceBuildDefaults.js";''')
replace_once(helper,
'''        if (!buildTokenMatches && !pairedMacTokenMatches) {\n          return unauthorized(res);\n        }''',
'''        if (!buildTokenMatches && !pairedMacTokenMatches) {\n          return unauthorized(res);\n        }\n        if (buildTokenMatches && !pairedMacTokenMatches && deviceBuildExpired(build)) {\n          return badRequest(res, 410, "Device build install page expired. Create a fresh build.");\n        }''')
replace_once(helper,
'''async function prepareDeviceDelivery(build, { markBuildFailed = true } = {}) {\n  try {\n    if (build.remoteBaseUrl || build.delivery?.mode === "custom") {\n      build.delivery = {\n        mode: "custom",\n        provider: "user-configured",\n        expiresAt: build.expiresAt,\n      };\n      deviceBuildStore.save(build);\n      return build;\n    }\n\n    const remainingMinutes = Math.max(5, Math.ceil((Date.parse(build.expiresAt) - Date.now()) / 60_000));\n    const delivery = await deviceDelivery.ensure({ ttlMinutes: remainingMinutes });\n    build.remoteBaseUrl = delivery.publicBaseUrl;\n    build.delivery = {\n      mode: "quick-tunnel",\n      provider: delivery.provider,\n      expiresAt: delivery.expiresAt,\n    };''',
'''async function prepareDeviceDelivery(build, { markBuildFailed = true } = {}) {\n  try {\n    const ttlMinutes = normalizeDeviceBuildTTLMinutes(build.installTTLMinutes);\n    if (build.remoteBaseUrl || build.delivery?.mode === "custom") {\n      build.expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();\n      build.delivery = {\n        mode: "custom",\n        provider: "user-configured",\n        expiresAt: build.expiresAt,\n      };\n      deviceBuildStore.save(build);\n      return build;\n    }\n\n    const delivery = await deviceDelivery.ensure({ ttlMinutes });\n    build.expiresAt = delivery.expiresAt;\n    build.remoteBaseUrl = delivery.publicBaseUrl;\n    build.delivery = {\n      mode: "quick-tunnel",\n      provider: delivery.provider,\n      expiresAt: delivery.expiresAt,\n    };''')
replace_once(helper,
'''function serveFile(res, path, { contentType, filename }) {\n  if (!path || !existsSync(path)) {\n    return notFound(res, "Artifact is unavailable.");\n  }\n  const stat = statSync(path);\n  res.writeHead(200, {\n    "content-type": contentType,\n    "content-length": stat.size,\n    "content-disposition": `attachment; filename="${String(filename || "download").replaceAll("\\\"", "")}"`,\n    "cache-control": "private, no-store",\n    "referrer-policy": "no-referrer",\n    "x-content-type-options": "nosniff",\n  });\n  createReadStream(path).pipe(res);\n}\n\n''',
''' ''')
replace_once(helper,
'''        return serveFile(res, build.artifacts.ipaPath, {\n          contentType: "application/octet-stream",\n          filename: `${build.app.name || build.scheme || "App"}.ipa`,\n        });''',
'''        return serveFile(res, build.artifacts.ipaPath, {\n          contentType: "application/octet-stream",\n          filename: `${build.app.name || build.scheme || "App"}.ipa`,\n          notFound,\n        });''')

write("mac-helper/src/fileServer.js", r'''import { closeSync, fstatSync, openSync, createReadStream } from "node:fs";

export function serveFile(res, path, { contentType, filename, notFound }) {
  if (!path) return notFound(res, "Artifact is unavailable.");
  let fd;
  let stat;
  try {
    fd = openSync(path, "r");
    stat = fstatSync(fd);
  } catch {
    if (fd !== undefined) try { closeSync(fd); } catch {}
    return notFound(res, "Artifact is unavailable.");
  }

  const stream = createReadStream(path, { fd, autoClose: true });
  let completed = false;
  stream.once("error", (error) => {
    if (completed) return;
    completed = true;
    if (!res.headersSent) return notFound(res, "Artifact is unavailable.");
    res.destroy(error);
  });
  stream.once("close", () => { completed = true; });
  res.once("close", () => stream.destroy());
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": stat.size,
    "content-disposition": `attachment; filename="${String(filename || "download").replaceAll("\"", "")}"`,
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  stream.pipe(res);
}
''')

http = "mac-helper/src/http.js"
replace_once(http,
'''  let body = "";\n  let received = 0;\n  for await (const chunk of req) {\n    received += chunk.length;\n    if (received > maxBytes) {\n      req.destroy();\n      throw new Error("Request body is too large.");\n    }\n    body += chunk;\n  }\n  if (!body.trim()) return {};\n  return JSON.parse(body);''',
'''  const chunks = [];\n  let received = 0;\n  for await (const chunk of req) {\n    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);\n    received += buffer.length;\n    if (received > maxBytes) {\n      req.destroy();\n      throw new Error("Request body is too large.");\n    }\n    chunks.push(buffer);\n  }\n  const body = Buffer.concat(chunks, received).toString("utf8");\n  if (!body.trim()) return {};\n  return JSON.parse(body);''')

delivery = "mac-helper/src/deviceDelivery.js"
replace_once(delivery,
'''function recordedDeliveryProcessesAlive(state) {\n  return deliveryIdentities(state).some((identity) => processIsAlive(identity.pid));\n}\n\nfunction recordedDeliveryProcessesExited(state) {\n  return deliveryIdentities(state).every((identity) => !processIsAlive(identity.pid));\n}\n\nfunction deliveryIdentities(state) {\n  return [state.managerIdentity, state.gatewayIdentity, state.tunnelIdentity].filter(Boolean);\n}''',
'''function recordedDeliveryProcessesAlive(state) {\n  return deliveryIdentities(state).some((identity) => processIsAlive(identity.pid))\n    || legacyDeliveryPIDs(state).some(processIsAlive);\n}\n\nfunction recordedDeliveryProcessesExited(state) {\n  return deliveryIdentities(state).every((identity) => !processIsAlive(identity.pid))\n    && legacyDeliveryPIDs(state).every((pid) => !processIsAlive(pid));\n}\n\nfunction deliveryIdentities(state) {\n  return [state.managerIdentity, state.gatewayIdentity, state.tunnelIdentity].filter(Boolean);\n}\n\nfunction legacyDeliveryPIDs(state) {\n  if (deliveryIdentities(state).length > 0) return [];\n  return [state.managerPid, state.gatewayPid, state.tunnelPid]\n    .map(Number)\n    .filter((pid) => Number.isInteger(pid) && pid > 0);\n}''')
replace_once(delivery,
'  const identities = deliveryIdentities(state);\n  if (identities.length === 0) {\n    return { signalled: false, allExited: true, survivors: [] };\n  }',
'  const identities = deliveryIdentities(state);\n  const legacyPIDs = legacyDeliveryPIDs(state);\n  if (identities.length === 0 && legacyPIDs.length === 0) {\n    return { signalled: false, allExited: true, survivors: [] };\n  }')
replace_once(delivery,
'''  const survivors = identities\n    .filter((identity) => processIsAlive(identity.pid))\n    .map((identity) => ({\n      pid: Number(identity.pid),\n      ownershipVerified: processIdentityMatches(identity),\n    }));''',
'''  const survivors = [\n    ...identities\n      .filter((identity) => processIsAlive(identity.pid))\n      .map((identity) => ({\n        pid: Number(identity.pid),\n        ownershipVerified: processIdentityMatches(identity),\n      })),\n    ...legacyDeliveryPIDs(state)\n      .filter(processIsAlive)\n      .map((pid) => ({ pid, ownershipVerified: false, legacy: true })),\n  ];''')
replace_once(delivery,
'''    pid: process.pid,\n    startedAt: processStartedAt(process.pid),''',
'''    pid: process.pid,\n    startedAt: requiredProcessStartedAt(process.pid),''')
insert_before(delivery,
'''function processStartedAt(pid) {''',
'''function requiredProcessStartedAt(pid) {\n  for (let attempt = 0; attempt < 3; attempt += 1) {\n    const startedAt = processStartedAt(pid);\n    if (startedAt) return startedAt;\n    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);\n  }\n  throw new DeviceDeliveryError("Unable to establish a process start identity for the delivery lifecycle lock.");\n}\n\n''')
replace_once(delivery,
'''  if (!identity || !processIsAlive(identity.pid)) return false;''',
'''  if (!identity || !identity.startedAt || !processIsAlive(identity.pid)) return false;''')
replace_once(delivery,
'''  return !identity.startedAt || processStartedAt(identity.pid) === identity.startedAt;''',
'''  return processStartedAt(identity.pid) === identity.startedAt;''')

manager = "mac-helper/bin/swift-sim-device-delivery.js"
replace_once(manager,
'''function processIdentity(pid, commandFragments) {\n  return {\n    pid,\n    startedAt: processStartedAt(pid),\n    commandFragments,\n  };\n}''',
'''function processIdentity(pid, commandFragments) {\n  const startedAt = requiredProcessStartedAt(pid);\n  return { pid, startedAt, commandFragments };\n}\n\nfunction requiredProcessStartedAt(pid) {\n  for (let attempt = 0; attempt < 3; attempt += 1) {\n    const startedAt = processStartedAt(pid);\n    if (startedAt) return startedAt;\n  }\n  throw new Error(`Unable to establish process identity for pid ${pid}.`);\n}''')

package = "package.json"
replace_once(package,
'''node --check mac-helper/src/deviceDeliveryCore.js && npm run check:docs''',
'''node --check mac-helper/src/deviceDeliveryCore.js && node --check mac-helper/src/fileServer.js && npm run check:docs''')

install_tests = "Companion/SwiftSimCompanionTests/InstallationStateTests.swift"
insert_before(install_tests,
'''    private let statusJSON = #"""''',
'''    @MainActor\n    func testPendingPairingSurvivesDefaultsMonitoringUntilCancelled() throws {\n        let defaults = UserDefaults.standard\n        let pairingID = "https://pending-\\(UUID().uuidString).example"\n        let token = "pending-secret-\\(UUID().uuidString)"\n        defaults.removeObject(forKey: "pairedMac")\n        defaults.removeObject(forKey: "pairedMacCredentialAccount")\n        defaults.removeObject(forKey: "pairedMacPendingCredentialAccount")\n        defaults.removeObject(forKey: "pairedMacPendingPairingID")\n        PairingCredentialVault.startMonitoring()\n        XCTAssertTrue(PairingCredentialVault.stagePairing(token: token, pairingID: pairingID))\n        let account = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))\n        defer {\n            PairingCredentialVault.cancelStagedPairing(pairingID: pairingID)\n            deleteTestToken(account: account)\n        }\n        RunLoop.main.run(until: Date().addingTimeInterval(0.2))\n        XCTAssertEqual(testTokenStatus(account: account), errSecSuccess)\n    }\n\n    @MainActor\n    func testCancellingSameMacReplacementPreservesCommittedToken() throws {\n        let defaults = UserDefaults.standard\n        defaults.removeObject(forKey: "pairedMac")\n        defaults.removeObject(forKey: "pairedMacCredentialAccount")\n        defaults.removeObject(forKey: "pairedMacPendingCredentialAccount")\n        defaults.removeObject(forKey: "pairedMacPendingPairingID")\n        let baseURL = URL(string: "https://same-mac-\\(UUID().uuidString).example")!\n        let oldToken = "old-secret-\\(UUID().uuidString)"\n        let newToken = "new-secret-\\(UUID().uuidString)"\n        let original = PairedMac(token: oldToken, baseURL: baseURL)\n        let metadata = try JSONEncoder().encode(original)\n        defaults.set(metadata, forKey: "pairedMac")\n        PairingCredentialVault.prepareForSessionStore()\n        let committed = try XCTUnwrap(defaults.string(forKey: "pairedMacCredentialAccount"))\n        defer {\n            deleteTestToken(account: committed)\n            if let pending = defaults.string(forKey: "pairedMacPendingCredentialAccount") {\n                deleteTestToken(account: pending)\n            }\n            defaults.removeObject(forKey: "pairedMac")\n            defaults.removeObject(forKey: "pairedMacCredentialAccount")\n            defaults.removeObject(forKey: "pairedMacPendingCredentialAccount")\n            defaults.removeObject(forKey: "pairedMacPendingPairingID")\n        }\n        XCTAssertTrue(PairingCredentialVault.stagePairing(token: newToken, pairingID: original.id))\n        PairingCredentialVault.cancelStagedPairing(pairingID: original.id)\n        let restored = try JSONDecoder().decode(PairedMac.self, from: metadata)\n        XCTAssertEqual(restored.token, oldToken)\n    }\n\n''')

device_tests = "test/deviceBuildStore.test.js"
replace_once(device_tests,
'''  store.save(stale);\n  assert.equal(store.get(build.id), undefined);''',
'''  assert.throws(() => store.save(stale), /cancelled or deleted/);\n  assert.equal(store.get(build.id), undefined);''')
Path(device_tests).write_text(Path(device_tests).read_text() + r'''

test("queued builds do not spend install-link TTL before delivery", () => withStore((store) => {
  const build = store.create({ scheme: "Example", ttlMinutes: 5 });
  assert.equal(build.expiresAt, "");
  assert.equal(build.installTTLMinutes, 5);
}));

test("deleting a validating build persists cancellation and delayed cleanup", () => withStore((store, directory) => {
  const build = store.create({ scheme: "Example" });
  build.app = {
    identity: deviceAppIdentity({ bundleIdentifier: "com.example.cancel", teamID: "TEAM123" }),
    name: "Example",
    bundleIdentifier: "com.example.cancel",
    teamID: "TEAM123",
    version: "1",
    build: "1",
  };
  build.state = "validating";
  store.save(build);
  assert.equal(store.deleteApp(build.app.identity), true);
  assert.equal(existsSync(build.control.cancelPath), true);
  const persisted = JSON.parse(readFileSync(join(directory, "builds.json"), "utf8"));
  const jobs = Object.values(persisted.artifactCleanupJobs);
  assert.equal(jobs.length, 1);
  assert.ok(Date.parse(jobs[0].nextAttemptAt) > Date.now() + 60 * 60 * 1000);
}));
''')

delivery_tests = "test/deviceDelivery.test.js"
Path(delivery_tests).write_text(Path(delivery_tests).read_text() + r'''

test("legacy delivery pids remain recorded instead of being treated as exited", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-delivery-legacy-test-"));
  try {
    const statePath = join(directory, "device-delivery.json");
    writeFileSync(statePath, JSON.stringify({
      generation: "legacy-generation",
      status: "ready",
      publicBaseUrl: "https://legacy.trycloudflare.com",
      managerPid: process.pid,
      gatewayPid: 0,
      tunnelPid: 0,
    }));
    const adapter = new DeviceDeliveryAdapter({ statePath, logPath: join(directory, "delivery.log") });
    assert.equal(adapter.stop(), false);
    const preserved = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(preserved.status, "failed-shutdown");
    assert.equal(preserved.survivingProcesses[0].pid, process.pid);
    assert.equal(preserved.survivingProcesses[0].legacy, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
''')

write("test/ioHardening.test.js", r'''import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { readJson } from "../mac-helper/src/http.js";
import { serveFile } from "../mac-helper/src/fileServer.js";


test("readJson preserves UTF-8 characters split across chunks", async () => {
  const payload = Buffer.from(JSON.stringify({ scheme: "Café 🚀" }));
  const rocket = payload.indexOf(Buffer.from("🚀"));
  const req = Readable.from([
    payload.subarray(0, rocket + 1),
    payload.subarray(rocket + 1, rocket + 3),
    payload.subarray(rocket + 3),
  ]);
  req.headers = {};
  req.destroy = () => {};
  assert.deepEqual(await readJson(req), { scheme: "Café 🚀" });
});


test("artifact streaming keeps an opened file readable after unlink", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-file-server-test-"));
  const path = join(directory, "app.ipa");
  const payload = Buffer.alloc(256 * 1024, 7);
  writeFileSync(path, payload);
  const server = createServer((_, res) => serveFile(res, path, {
    contentType: "application/octet-stream",
    filename: "app.ipa",
    notFound: (response, message) => {
      response.writeHead(404);
      response.end(message);
    },
  }));
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}`);
    unlinkSync(path);
    const received = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.deepEqual(received, payload);
  } finally {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
''')

print("Applied review-round fixes")
