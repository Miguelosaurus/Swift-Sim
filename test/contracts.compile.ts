import { deliveryEnvelope, type DeliveryEnvelope } from "../mac-helper/src/contracts/delivery.js";

const valid: DeliveryEnvelope = deliveryEnvelope({
  outcome: "no-change",
  message: "No change.",
});
void valid;

const invalidOutcome = {
  outcome: "hotPatch",
  message: "invalid",
  delivery: { kind: "live", revision: 1 },
};
// @ts-expect-error Unsupported outcomes cannot cross the typed delivery boundary.
deliveryEnvelope(invalidOutcome);

const invalidInstall = {
  outcome: "install-link-ready",
  message: "invalid",
  delivery: { kind: "install", universalLink: "https://example.test/install" },
} as const;
// @ts-expect-error Install deliveries require the state and preserveData fields.
deliveryEnvelope({
  ...invalidInstall,
});

const invalidKind = {
  outcome: "hot-reloaded",
  message: "invalid",
  delivery: {
    kind: "install",
    universalLink: "https://example.test/install",
    state: "verified",
    preserveData: true,
  },
} as const;
// @ts-expect-error A hot-reload envelope cannot carry an install delivery.
deliveryEnvelope({
  ...invalidKind,
});
