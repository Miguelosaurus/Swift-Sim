// A successful link is not necessarily a launchable image. Some Apple linker
// versions combine -interposable with hidden native definitions into strong
// imports from <this-image>; dyld cannot resolve those private definitions.
// Inspect only the managed Debug lane, without choosing another linker or
// changing the application's project or shipping configuration.
const MAX_INSPECTION_BYTES = 128 * 1024 * 1024;
const MAX_INSPECTION_LINE_BYTES = 16 * 1024;
const INSPECTION_TIMEOUT_MS = 30_000;

export class LiveBuildLinkerCompatibilityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LiveBuildLinkerCompatibilityError";
    this.code = code;
  }
}

export async function verifyLiveBuildLinkerCompatibility(imagePaths, { runCommand, cancelPath = "" }) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0 || imagePaths.length > 64
    || imagePaths.some((path) => typeof path !== "string" || !path)) throw inspectionError();
  let unsafeImportCount = 0;
  for (const imagePath of imagePaths) {
    const imports = new Map();
    const importArchitectures = new Set();
    let architecture = "";
    let sawImportsHeader = false;
    await inspect(["dyld_info", "-imports", imagePath], (line) => {
      const heading = line.match(/\s+\[([^\]]+)\]:\s*$/);
      if (heading) {
        architecture = heading[1];
        importArchitectures.add(architecture);
      }
      if (/^\s*-imports:\s*$/.test(line)) sawImportsHeader = true;
      if (!line.includes("(from <this-image>)")) return;
      const match = line.match(/^\s*0x[\da-f]+\s+(\S+)\s+(.*?)\(from <this-image>\)\s*$/i);
      if (!match) throw inspectionError();
      if (/\bweak[- ]import\b/i.test(match[2])) return;
      const symbols = imports.get(architecture) || new Set();
      symbols.add(match[1]);
      imports.set(architecture, symbols);
    }, { runCommand, cancelPath });
    if (!sawImportsHeader) throw inspectionError();
    if (imports.size === 0) continue;

    const privateDefinitions = new Map();
    const externalDefinitions = new Map();
    const importedSymbols = new Set([...imports.values()].flatMap((symbols) => [...symbols]));
    let hasSymbolArchitectureHeader = false;
    architecture = "";
    await inspect(["nm", "-arch", "all", "-m", "-U", imagePath], (line) => {
      const heading = line.match(/\(for architecture ([^)]+)\):\s*$/);
      if (heading) {
        architecture = heading[1];
        hasSymbolArchitectureHeader = true;
      }
      const definition = line.match(/^\s*[\da-f]+\s+\([^)]+\)\s+(.*?)\s+(\S+)\s*$/i);
      if (!definition) return;
      const [, attributes, symbol] = definition;
      if (!importedSymbols.has(symbol)) return;
      const destination = /\bnon-external\b/.test(attributes)
        ? privateDefinitions
        : /\bexternal\b/.test(attributes) ? externalDefinitions : null;
      if (!destination) return;
      const symbols = destination.get(architecture) || new Set();
      symbols.add(symbol);
      destination.set(architecture, symbols);
    }, { runCommand, cancelPath });

    for (const [importArchitecture, symbols] of imports) {
      // nm omits an architecture header for thin binaries. It must never be
      // borrowed across slices in a universal binary.
      if (!hasSymbolArchitectureHeader && importArchitectures.size > 1) throw inspectionError();
      const key = !hasSymbolArchitectureHeader ? "" : importArchitecture;
      const hidden = privateDefinitions.get(key) || new Set();
      const exported = externalDefinitions.get(key) || new Set();
      for (const symbol of symbols) {
        if (!hidden.has(symbol) && !exported.has(symbol)) throw inspectionError();
        if (hidden.has(symbol) && !exported.has(symbol)) unsafeImportCount += 1;
      }
    }
  }
  if (unsafeImportCount) {
    const error = new LiveBuildLinkerCompatibilityError(
      "LIVE_LINKER_INCOMPATIBLE",
      "The live-enabled Debug app contains private self-imports that dyld cannot resolve. "
        + "Swift Sim stopped before packaging an install. Use a verified compatible linker "
        + "for the application target's Debug configuration, or build without live instrumentation. "
        + "Keep Release settings unchanged. See docs/TROUBLESHOOTING.md (Debug linker compatibility).",
    );
    error.unsafeImportCount = unsafeImportCount;
    throw error;
  }
  return { inspectedImages: imagePaths.length, unsafeImportCount: 0 };
}

async function inspect(args, consumeLine, { runCommand, cancelPath }) {
  let bytes = 0;
  let result;
  try {
    result = await runCommand("xcrun", args, {
      timeoutMs: INSPECTION_TIMEOUT_MS,
      cancelPath,
      onLine: (line) => {
        const lineBytes = Buffer.byteLength(line);
        bytes += lineBytes + 1;
        if (lineBytes > MAX_INSPECTION_LINE_BYTES || bytes > MAX_INSPECTION_BYTES) throw inspectionError();
        consumeLine(line);
      },
    });
  } catch (error) {
    if (error?.code === "SWIFT_SIM_BUILD_CANCELLED") throw error;
    throw inspectionError();
  }
  if (result?.cancellationError) throw result.cancellationError;
  if (result?.code !== 0 || result?.error) throw inspectionError();
}

function inspectionError() {
  return new LiveBuildLinkerCompatibilityError(
    "LIVE_LINKER_INSPECTION_FAILED",
    "Swift Sim could not complete the Debug linker compatibility check. "
      + "No install was packaged. Check the selected Xcode command-line tools and rebuild; "
      + "do not treat compiler success as a successful app launch.",
  );
}
