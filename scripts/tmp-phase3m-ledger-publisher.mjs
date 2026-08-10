import fs from "node:fs";

const path = "docs/internal/plans/ARCHITECTURE_CONSOLIDATION_PROGRESS.md";
let text = fs.readFileSync(path, "utf8");

function replaceOnce(oldText, newText, label) {
  const first = text.indexOf(oldText);
  if (first < 0) throw new Error(`Missing ledger anchor: ${label}`);
  if (text.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`Duplicate ledger anchor: ${label}`);
  }
  text = text.slice(0, first) + newText + text.slice(first + oldText.length);
}

replaceOnce(
  "| 3 | Helper and HTTP decomposition | Partial implementation through corrective 3K; draft stack unmerged | [#34–#40, #56–#59](https://github.com/Miguelosaurus/Swift-Sim/pull/59) | Phase 2 final metadata / `f21e344` | Corrective implementation `9a17315` | The 1,852-line compatibility helper still owns device-build capability/artifact/install-page, pairing-page, lifecycle, process, persistence, and composition work; the Phase 3 gate is not met |",
  "| 3 | Helper and HTTP decomposition | Partial implementation through corrective 3M; draft stack unmerged | [#34–#40, #56–#60, #63](https://github.com/Miguelosaurus/Swift-Sim/pull/63) | Phase 2 final metadata / `f21e344` | Corrective implementation `ba97946` | HTTP route families are extracted; lifecycle/reconciliation/process behavior, module-global runtime construction, and remaining CLI composition still prevent the Phase 3 gate |",
  "program status",
);

replaceOnce(
  "- Status: Partially implemented in draft PRs #34–#40 and corrective PRs #56–#59; the master-plan Phase 3 gate is not met.",
  "- Status: Partially implemented in draft PRs #34–#40 and corrective PRs #56–#60 and #63; the HTTP-route decomposition portion is complete, but the master-plan Phase 3 gate is not met.",
  "phase 3 status",
);

replaceOnce(
  "- Corrective active-ancestry implementation head: PR #59 / `9a17315`, stacked after the Phase 4 pairing tranche, helper-state reliability correction, and PRs #56–#58 so validated history remains intact.",
  "- Corrective active-ancestry implementation head: PR #63 / `ba97946`, stacked after the Phase 4 pairing tranche, helper-state reliability correction, and PRs #56–#60 so validated history remains intact. Temporary formatter/publisher PRs #61 and #62 are closed, unmerged, and are not part of product ancestry.",
  "active ancestry head",
);

const slice59 = "- #59 extracts paired-Mac device-build start and renewal commands. The application service owns authorization, input projection, persistence orchestration, renewal rollback, and public projection; lazy keyed tracking coalesces a shared renewal lease and prevents a stale completion from deleting a replacement task. The private `start` command is excluded from public capability dispatch so the isolated gateway returns 404 rather than an authentication response.";
replaceOnce(
  slice59,
  `${slice59}\n- #60 extracts public device-build capability, artifact, manifest, install-request, verification, links, logs, and install-page routing behind an explicit application-service/route boundary while preserving paired-Mac versus capability authorization and response projection.\n- #63 extracts the final embedded \`GET /pair\` HTML route behind a pairing-page application service, renderer, and route boundary, preserving invite precedence, token authorization, request-origin handling, HTML escaping, exact security headers, and public-gateway 404 isolation.`,
  "implemented slices",
);

const gateMarker = "### Gate correction\n";
const evidence = `### Corrective Phase 3L evidence

- PR #60 implementation \`61dbb05\` extracted the public device-build capability/artifact/install-page family. Its first hosted run exposed only repository Prettier formatting in the two new production modules; the normal follow-up \`9a3be575\` applied the exact Prettier 3.7.0 output without rewriting history.
- Authoritative Verify run \`31417609440\` (#760) passed at exact head \`9a3be575\`: Node 24 \`npm run check\`, isolated clean Homebrew installation/service, workflow YAML, release-shell syntax, and iOS Simulator tests all passed.
- This remained a bounded corrective slice. The compatibility helper was reduced to 1,761 lines but still owned the pairing HTML route plus lifecycle/reconciliation/process behavior, persistence construction, module-global composition, and remaining CLI composition.

### Corrective Phase 3M evidence

- PR #63 implementation \`ba97946\` extracted the final embedded \`GET /pair\` route into an explicit application service, renderer, and route boundary. Invitation precedence, expired/claimed behavior, pairing-token authorization, request-origin-derived links, HTML escaping, content type, cache/CSP/referrer/nosniff headers, and device-build-only public-gateway 404 behavior are covered through stable seams.
- Focused adversarial review found no remaining correctness, authorization, projection, escaping, side-effect-ordering, or public-gateway-isolation finding. Authoritative Verify run \`31420399403\` (#763) passed at exact implementation head \`ba97946\`: full Node 24 checks, isolated clean Homebrew installation/service, workflow YAML, release-shell syntax, and iOS Simulator tests all passed.
- The current HTTP surface is now routed through explicit route/application-service boundaries with authorization metadata and compiled public-gateway isolation evidence. Phase 3 is still incomplete because the helper entrypoint owns service lifecycle/reconciliation, module-global runtime construction, direct orchestration/process functions outside route modules, and remaining CLI composition.

`;
replaceOnce(gateMarker, evidence + gateMarker, "gate evidence insertion");

const oldGate = `The 2026-08-09 independent stack audit found that PR #40's earlier Phase 3 completion claim was broader than the implemented scope. After corrective PRs #56–#59, \`mac-helper/bin/swift-sim-helper.js\` remains a 1,852-line compatibility implementation that constructs module-global stores, owns the remaining helper router, directly imports child-process APIs, and combines build, Simulator, delivery, recovery, persistence, and lifecycle behavior. Therefore:

- the helper entrypoint is not yet primarily wiring for the complete product surface;
- routes have not all been separated by authorization boundary;
- route/service code can still directly own process and persistence work;
- service startup, timers, sockets, and graceful shutdown do not yet have the complete target lifecycle owner.
`;
const newGate = `The 2026-08-09 independent stack audit found that PR #40's earlier Phase 3 completion claim was broader than the implemented scope. Corrective PRs #56–#60 and #63 have now completed the HTTP-route decomposition portion without rewriting the previously validated history: the current HTTP surface is behind explicit route/application-service boundaries, authorization metadata is contract-tested, and the compiled public gateway remains 404 for private routes. The remaining gate is composition and lifecycle. Therefore:

- the helper entrypoint is not yet primarily wiring for the complete product surface;
- service startup, reconciliation timers, socket tracking, signal handling, graceful drain, and forced shutdown do not yet have the complete target lifecycle owner;
- module-global stores/adapters and remaining CLI composition are still constructed in the compatibility helper;
- direct orchestration/process functions remain in the helper outside route modules, even though route modules themselves no longer directly spawn processes or mutate persistence.
`;
replaceOnce(oldGate, newGate, "gate correction");

fs.writeFileSync(path, text);
