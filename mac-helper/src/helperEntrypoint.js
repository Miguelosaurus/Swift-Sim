// @ts-check

/**
 * Install runtime boundaries before loading exactly one helper implementation.
 *
 * @param {{
 *   argv: string[],
 *   installBoundaries(): void,
 *   commandIsExtracted(command: string | undefined): boolean,
 *   loadExtracted(): Promise<(argv: string[]) => Promise<boolean>>,
 *   loadCompatibility(): Promise<unknown>,
 * }} options
 * @returns {Promise<"extracted" | "compatibility">}
 */
export async function runHelperBootstrap({
  argv,
  installBoundaries,
  commandIsExtracted,
  loadExtracted,
  loadCompatibility,
}) {
  assertArgv(argv);
  if (typeof installBoundaries !== "function") {
    throw new TypeError("Helper bootstrap requires installBoundaries.");
  }
  if (typeof commandIsExtracted !== "function") {
    throw new TypeError("Helper bootstrap requires commandIsExtracted.");
  }
  if (typeof loadExtracted !== "function") {
    throw new TypeError("Helper bootstrap requires loadExtracted.");
  }
  if (typeof loadCompatibility !== "function") {
    throw new TypeError("Helper bootstrap requires loadCompatibility.");
  }

  installBoundaries();
  if (!commandIsExtracted(argv[0])) {
    await loadCompatibility();
    return "compatibility";
  }

  const runExtracted = await loadExtracted();
  if (!(await runExtracted(argv))) {
    throw new Error("Extracted helper command classification mismatch.");
  }
  return "extracted";
}

/** @param {unknown} argv */
function assertArgv(argv) {
  if (!Array.isArray(argv) || !argv.every((value) => typeof value === "string")) {
    throw new TypeError("Helper entrypoint argv must be an array of strings.");
  }
}
