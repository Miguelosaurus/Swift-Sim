import { readFileSync } from "node:fs";

const VERSION = /^\d+\.\d+\.\d+$/;
const REVISION = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;

export function validateComponentContract(value, packageVersion) {
  const engine = value?.engine;
  const sdk = value?.sdk;
  const capabilities = (list) =>
    Array.isArray(list) &&
    list.length > 0 &&
    list.length <= 32 &&
    new Set(list).size === list.length &&
    list.every((s) => typeof s === "string" && /^[a-z0-9-]{1,80}$/.test(s));
  if (
    value?.schemaVersion !== 1 ||
    !VERSION.test(value.version || "") ||
    value.version !== packageVersion ||
    value.agents?.version !== packageVersion ||
    sdk?.version !== packageVersion ||
    !VERSION.test(engine?.version || "") ||
    !HASH.test(engine?.sha256 || "") ||
    !REVISION.test(engine?.sourceRevision || "") ||
    sdk.engineRevision !== engine.sourceRevision ||
    sdk.enginePackageVersion !== engine.version ||
    !capabilities(sdk.capabilities) ||
    value.helper?.protocol !== 1 ||
    !capabilities(value.helper.capabilities) ||
    engine.maxArchiveBytes !== 128 * 1024 * 1024 ||
    engine.bundleIdentifier !== "com.johnholdsworth.InjectionNext" ||
    engine.executable !== "InjectionNext" ||
    engine.url !==
      `https://github.com/Miguelosaurus/InjectionNext/releases/download/swift-sim-engine-${engine.version}/swift-sim-engine-${engine.version}-arm64-signed.zip`
  ) {
    throw Object.assign(
      new Error("The packaged Swift Sim components do not share one valid compatibility contract."),
      { code: "COMPONENT_CONTRACT_INVALID" },
    );
  }
  return value;
}

const packageJSON = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const contract = validateComponentContract(
  JSON.parse(readFileSync(new URL("../compatibility.json", import.meta.url), "utf8")),
  packageJSON.version,
);
function freeze(value) {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
export const COMPONENTS = freeze(contract);

export function engineMatchesContract(manifest, expected = COMPONENTS.engine) {
  return (
    manifest?.version === expected.version &&
    manifest?.sha256 === expected.sha256 &&
    manifest?.sourceRevision === expected.sourceRevision
  );
}

// Setup/doctor only. This reports local prerequisites, never phone installation
// or a successful live replacement; a connected app supplies its own receipts.
export function componentReadiness(
  { engineManifest, helperHealth, agentReady = false, privateRouteReady = false },
  expected = COMPONENTS,
) {
  const engineReady = engineMatchesContract(engineManifest, expected.engine);
  const helperReady =
    helperHealth?.ok === true &&
    helperHealth.version === expected.version &&
    Number(helperHealth.protocol ?? helperHealth.payload?.protocol) === expected.helper.protocol &&
    Array.isArray(helperHealth.capabilities || helperHealth.payload?.capabilities) &&
    expected.helper.capabilities.every((c) =>
      (helperHealth.capabilities || helperHealth.payload.capabilities).includes(c),
    );
  return {
    scope: "local-prerequisites",
    compatible: engineReady && helperReady && agentReady,
    ready: engineReady && helperReady && agentReady && privateRouteReady,
    phoneProofRequired: true,
    engine: {
      compatible: engineReady,
      expectedVersion: expected.engine.version,
      installedVersion: String(engineManifest?.version || ""),
      code: engineReady
        ? "READY"
        : engineManifest?.localCandidate
          ? "ENGINE_LOCAL_CANDIDATE_SELECTED"
          : engineManifest
            ? "ENGINE_UPDATE_REQUIRED"
            : "ENGINE_MISSING",
      action: engineReady
        ? ""
        : engineManifest?.localCandidate
          ? "The explicit local candidate differs from this release. Resolve that selection before using the packaged stack; setup preserves it."
          : "Run swift-sim setup to install the matching hot-reload engine.",
    },
    helper: {
      compatible: helperReady,
      code: helperReady ? "READY" : "HELPER_UPDATE_REQUIRED",
      action: helperReady ? "" : "Run swift-sim setup to reconcile the running Mac helper.",
    },
    sdk: {
      expectedVersion: expected.sdk.version,
      enginePackageVersion: expected.sdk.enginePackageVersion,
      state: "checked-on-debug-connection",
      phoneProofRequired: true,
    },
  };
}
