import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `Optional iPhone app testing (separate signed iCTRL 1.98.16 runner).

swift-sim app-control pair --host <phone-tailnet-ip>
swift-sim app-control configure --host <ip> --key-file <private-store> --device-id <id> [--record <entry>]
swift-sim app-control setup --device <paired-device> --team-id <development-team> [--profile <file>] [--bundle-id <existing-runner-id>]
swift-sim app-control status
swift-sim app-control check
swift-sim app-control open --app <bundle-id>
swift-sim app-control screen --session <id> [--filter <text>]
swift-sim app-control tap --session <id> --text <label> [--type <element-type>]
swift-sim app-control tap --session <id> --observation <id> --x <points> --y <points>
swift-sim app-control type --session <id> --observation <id> --text <text> [--clear] [--submit]
swift-sim app-control scroll --session <id> --observation <id> --direction down|up|left|right
swift-sim app-control screenshot --session <id>
swift-sim app-control close --session <id>

Open App Testing in Swift Sim to begin (swift-sim://app-testing).
Check authenticates readiness without opening an app, reading its UI or authorizing input.
A developer image must be available;
silent remote launch and post-reboot cellular preparation are not promised.
Only test while the user has made the phone available. Always close the session.
Installation is explicit. No daemon, recording, cloud service, or hot reload hook.
`;

export async function runAppControlCli(
  args,
  {
    run,
    write = (line) => console.log(line),
    stateRoot = join(homedir(), ".swift-sim", "app-control"),
  } = {},
) {
  if (!args.length || ["help", "--help", "-h"].includes(args[0])) {
    write(HELP);
    return 0;
  }
  const worker = join(
    dirname(fileURLToPath(import.meta.url)),
    `../optional/app-control/${args[0] === "setup" ? "setup.py" : "control.py"}`,
  );
  const result = await run({
    executable: "/usr/bin/env",
    args: ["python3", "-I", "-B", worker],
    input: JSON.stringify({ args, stateRoot }),
    environment: {
      inherit: ["PATH", "HOME", "TMPDIR", "SYSTEMROOT"],
      overrides: {},
      unset: [],
    },
    policy: {
      timeoutMs: args[0] === "setup" ? 420_000 : args[0] === "pair" ? 100_000 : 65_000,
      outputLimitBytes: 256 * 1024,
      processGroup: "new",
      acceptedExitCodes: [0, 1, 2],
    },
  });
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {}
  if (!value || value.schemaVersion !== 1 || typeof value.outcome !== "string") {
    write(
      JSON.stringify({
        schemaVersion: 1,
        outcome: "needs-user-action",
        code: "APP_CONTROL_WORKER_UNAVAILABLE",
        guidance: result.timedOut
          ? "The testing command timed out. Inspect the app before retrying any input."
          : "App testing needs Python 3.9 or later. Normal Swift Sim delivery is unaffected.",
      }),
    );
    return 1;
  }
  write(JSON.stringify(value));
  return result.code === 0 ? 0 : 1;
}
