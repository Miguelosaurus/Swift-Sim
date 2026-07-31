const SAFE_PUBLIC_LOGS = new Map([
  ["Reading Xcode signing settings.", "Reading Xcode signing settings."],
  ["Archiving for generic iOS device.", "Archiving for generic iOS device."],
  ["Exporting signed IPA.", "Exporting signed IPA."],
  ["Build is ready to install.", "Build is ready to install."],
  ["Build is ready to install and hot reload.", "Build is ready to install and hot reload."],
  ["Temporary HTTPS install link is ready. Tailscale is not required.", "Temporary HTTPS install link is ready. Tailscale is not required."],
  ["A new install link was generated from the saved app.", "A new install link was generated from the saved app."],
  ["Build was interrupted before completion.", "Build was interrupted before completion."],
  ["A previous helper run ended during this build. Start a new build to continue.", "A previous helper run ended during this build. Start a new build to continue."],
  ["A previous helper run ended during this build, and its worker could not be safely confirmed stopped.", "A previous helper run ended during this build, and its worker could not be safely confirmed stopped."],
  ["Preparing Swift Sim's private live patch lane.", "Preparing Swift Sim's private live patch lane."],
  ["Building the signed live-enabled Debug app.", "Building the signed live-enabled Debug app."],
  ["Packaging the signed Debug app as an installable IPA.", "Packaging the signed Debug app as an installable IPA."],
  ["Live patch preparation was unavailable; the signed install will still continue.", "Live patch preparation was unavailable; the signed install will still continue."],
]);
const REDACTED_OUTPUT = "[build output redacted]";

export function sanitizePublicBuildLogs(build, { limit = 300 } = {}) {
  const maximum = Math.max(0, Math.min(300, Number(limit) || 0));
  if (maximum === 0) return [];
  const result = [];
  for (const raw of (Array.isArray(build?.logs) ? build.logs : []).slice(-maximum)) {
    const line = String(raw ?? "").replace(/[\r\n]+/g, " ").trim();
    const safe = SAFE_PUBLIC_LOGS.get(line)
      || capturedCompilationMessage(line)
      || REDACTED_OUTPUT;
    if (safe === REDACTED_OUTPUT && result.at(-1) === REDACTED_OUTPUT) continue;
    result.push(safe);
  }
  return result;
}

function capturedCompilationMessage(line) {
  const match = line.match(/^Captured (\d{1,6}) live Swift compilation commands?\.$/);
  if (!match) return "";
  const count = Number(match[1]);
  return `Captured ${count} live Swift compilation ${count === 1 ? "command" : "commands"}.`;
}
