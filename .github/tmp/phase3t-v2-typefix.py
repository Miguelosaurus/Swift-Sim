from pathlib import Path

path = Path("mac-helper/src/commands/setupStatusService.js")
text = path.read_text()

replacements = [
    (
        '  /** @param {{ selected?: TailscaleProbe, probes: TailscaleProbe[], conflict: boolean }} inspection */\n',
        '  /** @param {{ selected: TailscaleProbe | undefined, probes: TailscaleProbe[], conflict: boolean }} inspection */\n',
        "exact optional selected",
    ),
    (
        '  function tailscaleCandidates() {\n    const candidates = [{ mode: "default", command: "tailscale", args: [] }];\n',
        '  function tailscaleCandidates() {\n    /** @type {TailscaleCandidate[]} */\n    const candidates = [{ mode: "default", command: "tailscale", args: [] }];\n',
        "candidate array typing",
    ),
    (
        '  if (!dependencies.commandRunner || typeof dependencies.commandRunner.run !== "function") {\n',
        '  if (typeof dependencies?.commandRunner?.run !== "function") {\n',
        "command runner validation narrowing",
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    text = text.replace(old, new, 1)

path.write_text(text)
