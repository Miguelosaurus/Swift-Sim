import assert from "node:assert/strict";
import test from "node:test";
import {
  selectTailscaleProbe,
  tailscaleBackendsConflict,
} from "../mac-helper/src/tailscaleBackends.js";

function probe(mode, id, dnsName = `${id}.example.ts.net`) {
  return {
    candidate: { mode },
    parsed: id ? { Self: { ID: id, DNSName: dnsName, Online: true } } : undefined,
  };
}

test("pairing fails closed when app and userspace Tailscale identify different Macs", () => {
  const probes = [
    probe("default", ""),
    probe("app", "new-mac"),
    probe("userspace", "old-mac"),
  ];
  const selected = selectTailscaleProbe(probes);

  assert.equal(selected.candidate.mode, "app");
  assert.equal(tailscaleBackendsConflict(probes, selected), true);
});

test("duplicate CLI views of the same Tailscale backend are not a conflict", () => {
  const probes = [
    probe("default", "current-mac"),
    probe("app", "current-mac"),
  ];
  const selected = selectTailscaleProbe(probes);

  assert.equal(selected.candidate.mode, "default");
  assert.equal(tailscaleBackendsConflict(probes, selected), false);
});

test("an explicit Tailscale mode resolves an intentional multi-backend setup", () => {
  const probes = [
    probe("app", "new-mac"),
    probe("userspace", "automation-node"),
  ];
  const selected = selectTailscaleProbe(probes, "userspace");

  assert.equal(selected.candidate.mode, "userspace");
  assert.equal(tailscaleBackendsConflict(probes, selected, "userspace"), false);
});
