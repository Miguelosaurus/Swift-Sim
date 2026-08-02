from pathlib import Path


def replace_exact(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


def append_once(path: str, marker: str, content: str) -> None:
    file = Path(path)
    text = file.read_text()
    if marker in text:
        raise SystemExit(f"{path}: marker already exists")
    file.write_text(text.rstrip() + "\n\n" + content.strip() + "\n")


replace_exact(
    "mac-helper/src/liveEngineOwnershipPreload.js",
    '''export function kernelProcessIdentity(pid) {
''',
    '''export function prepareKernelProcessIdentity() {
  return process.platform !== "darwin" || Boolean(identityHelperExecutable());
}

export function kernelProcessIdentity(pid) {
''',
)

replace_exact(
    "mac-helper/src/ownedWorkerIdentity.js",
    'import { kernelProcessIdentity } from "./liveEngineOwnershipPreload.js";\n',
    'import { kernelProcessIdentity, prepareKernelProcessIdentity } from "./liveEngineOwnershipPreload.js";\n',
)
replace_exact(
    "mac-helper/src/ownedWorkerIdentity.js",
    '''const OWNED_WORKER_RECORD_VERSION = 2;

export function requiredOwnedWorkerProcessRecord''',
    '''const OWNED_WORKER_RECORD_VERSION = 2;

export function prepareOwnedWorkerProcessIdentity() {
  if (prepareKernelProcessIdentity()) return;
  throw new Error("Unable to prepare the build-worker process identity verifier.");
}

export function requiredOwnedWorkerProcessRecord''',
)

replace_exact(
    "mac-helper/src/deviceBuilderCore.js",
    'import { ownedWorkerProcessState, requiredOwnedWorkerProcessRecord } from "./ownedWorkerIdentity.js";\n',
    'import { ownedWorkerProcessState, prepareOwnedWorkerProcessIdentity, requiredOwnedWorkerProcessRecord } from "./ownedWorkerIdentity.js";\n',
)
replace_exact(
    "mac-helper/src/deviceBuilderCore.js",
    '''} = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
''',
    '''} = {}) {
  return new Promise((resolve) => {
    const workerPath = cancelPath ? `${cancelPath}.worker.json` : "";
    if (workerPath) {
      try {
        // The owned-worker supervisor waits only for its durable journal. On
        // first macOS use, prepare the kernel helper before spawning so compiler
        // startup cannot consume that handshake window.
        prepareOwnedWorkerProcessIdentity();
      } catch (error) {
        resolve({
          code: null,
          stdout: "",
          stderr: "",
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
    const child = spawn(command, args, {
''',
)
replace_exact(
    "mac-helper/src/deviceBuilderCore.js",
    '''    let workerRecordError = null;
    const workerPath = cancelPath ? `${cancelPath}.worker.json` : "";
    if (workerPath) {
''',
    '''    let workerRecordError = null;
    if (workerPath) {
''',
)

replace_exact(
    "mac-helper/src/buildValidation.js",
    'import { requiredOwnedWorkerProcessRecord } from "./ownedWorkerIdentity.js";\n',
    'import { prepareOwnedWorkerProcessIdentity, requiredOwnedWorkerProcessRecord } from "./ownedWorkerIdentity.js";\n',
)
replace_exact(
    "mac-helper/src/buildValidation.js",
    '''function runValidationCommand(command, { cwd, timeoutMs, cancelPath = "" }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("/bin/sh", ["-lc", command], {
''',
    '''function runValidationCommand(command, { cwd, timeoutMs, cancelPath = "" }) {
  return new Promise((resolvePromise, reject) => {
    if (cancelPath) {
      try {
        prepareOwnedWorkerProcessIdentity();
      } catch (error) {
        reject(validationError(
          `Unable to prepare the active validation worker identity: ${error instanceof Error ? error.message : String(error)}`
        ));
        return;
      }
    }
    const child = spawn("/bin/sh", ["-lc", command], {
''',
)

append_once(
    "test/mainPostMergeIntegration.test.js",
    "worker identity verification is prepared before supervised commands spawn",
    r'''test("worker identity verification is prepared before supervised commands spawn", () => {
  const builder = readFileSync("mac-helper/src/deviceBuilderCore.js", "utf8");
  const bufferedStart = builder.indexOf("export function runBuffered");
  const bufferedEnd = builder.indexOf("async function terminateProcessGroup", bufferedStart);
  const buffered = builder.slice(bufferedStart, bufferedEnd);
  assert.ok(buffered.indexOf("prepareOwnedWorkerProcessIdentity()") >= 0);
  assert.ok(buffered.indexOf("prepareOwnedWorkerProcessIdentity()") < buffered.indexOf("const child = spawn"));

  const validation = readFileSync("mac-helper/src/buildValidation.js", "utf8");
  const validationStart = validation.indexOf("function runValidationCommand");
  const validationEnd = validation.indexOf("async function terminateProcessGroup", validationStart);
  const validationCommand = validation.slice(validationStart, validationEnd);
  assert.ok(validationCommand.indexOf("prepareOwnedWorkerProcessIdentity()") >= 0);
  assert.ok(validationCommand.indexOf("prepareOwnedWorkerProcessIdentity()") < validationCommand.indexOf("const child = spawn"));
});''',
)

replace_exact("docs/MAIN_POST_MERGE_REVIEW_ROUND1.md", "| P2 | 15 | 15 | 0 |", "| P2 | 16 | 16 | 0 |")
replace_exact(
    "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md",
    "15. Same-identity Companion history from another Mac or an ownerless link survives Mac synchronization and remains local-only instead of being overwritten or inheriting remote mutation authority.\n",
    "15. Same-identity Companion history from another Mac or an ownerless link survives Mac synchronization and remains local-only instead of being overwritten or inheriting remote mutation authority.\n"
    "16. The kernel worker-identity verifier is prepared before spawning the journal-gated supervisor, so first-use Xcode/clang startup cannot exhaust the supervisor handshake and fail an otherwise valid build.\n",
)
replace_exact(
    "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md",
    "persisted worker-journal identity and legacy-record rejection,",
    "persisted worker-journal identity, legacy-record rejection, pre-spawn identity preparation,",
)

Path(".github/workflows/manual-review-round3-worker-prewarm.yml").unlink(missing_ok=True)
Path("scripts/manual-review-round3-worker-prewarm.py").unlink(missing_ok=True)
