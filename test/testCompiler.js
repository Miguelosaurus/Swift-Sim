import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFullCallableCompiler } from "../mac-helper/src/fullCallableCompiler.js";
import { NodeCommandRunner } from "../mac-helper/src/infrastructure/nodeCommandRunner.js";

const cacheRoot = mkdtempSync(join(tmpdir(), "swift-sim-test-compiler-"));
chmodSync(cacheRoot, 0o700);
process.on("exit", () => rmSync(cacheRoot, { recursive: true, force: true }));
export const testCompiler = createFullCallableCompiler({ runner: new NodeCommandRunner({ spawn, spawnSync }), cacheRoot });
