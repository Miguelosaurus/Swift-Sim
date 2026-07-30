export function selectTailscaleProbe(probes, preferredMode = "") {
  const working = probes.filter((probe) => probe.parsed);
  if (preferredMode) {
    return working.find((probe) => probe.candidate.mode === preferredMode);
  }
  return working.find((probe) => probe.candidate.mode === "default")
    || working.find((probe) => probe.candidate.mode === "app")
    || working.find((probe) => probe.candidate.mode === "userspace");
}

export function tailscaleBackendsConflict(probes, selected, preferredMode = "") {
  if (preferredMode) return false;
  const working = probes.filter((probe) => probe.parsed);
  const identities = new Set(working.map(tailscaleIdentity).filter(Boolean));
  const hasApp = probes.some((probe) => probe.candidate.mode === "app");
  const hasUserspace = probes.some((probe) => probe.candidate.mode === "userspace");
  return identities.size > 1
    || (hasApp && hasUserspace && selected?.candidate.mode === "userspace");
}

function tailscaleIdentity(probe) {
  return probe.parsed?.Self?.ID
    || probe.parsed?.Self?.DNSName
    || (probe.parsed?.TailscaleIPs || []).join(",");
}
