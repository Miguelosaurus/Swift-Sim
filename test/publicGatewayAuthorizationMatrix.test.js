import assert from "node:assert/strict";
import test from "node:test";
import { deviceDeliveryRequestAllowed } from "../mac-helper/src/deviceDelivery.js";
import { helperControlAuthorizationMatrix } from "../mac-helper/src/http/helperControlRoutes.js";
import { sessionRouteAuthorizationMatrix } from "../mac-helper/src/http/sessionRoutes.js";
import { deviceAppAuthorizationMatrix } from "../mac-helper/src/http/deviceAppRoutes.js";
import { deviceBuildCommandAuthorizationMatrix } from "../mac-helper/src/http/deviceBuildCommandRoutes.js";
import { deviceBuildCapabilityAuthorizationMatrix } from "../mac-helper/src/http/deviceBuildCapabilityRoutes.js";
import { pairingPageAuthorizationMatrix } from "../mac-helper/src/http/pairingPageRoutes.js";

const PUBLIC_DELIVERY_EXPOSURES = new Set([
  "helper-and-public-gateway",
  "public-delivery",
  "public-delivery-or-private-helper",
]);

const MATRICES = [
  ...helperControlAuthorizationMatrix,
  ...sessionRouteAuthorizationMatrix,
  ...deviceAppAuthorizationMatrix,
  ...deviceBuildCommandAuthorizationMatrix,
  ...deviceBuildCapabilityAuthorizationMatrix,
  ...pairingPageAuthorizationMatrix,
];

test("public delivery gateway matches every declared Phase 3 route exposure", () => {
  assert.ok(MATRICES.length > 0);
  for (const entry of MATRICES) {
    const { method, path } = materialize(entry.route);
    const expected = PUBLIC_DELIVERY_EXPOSURES.has(entry.exposure);
    assert.equal(
      deviceDeliveryRequestAllowed(method, path),
      expected,
      `${entry.route} (${entry.exposure}) must ${expected ? "be allowed" : "return 404"} on the public delivery gateway`,
    );
  }
});

function materialize(route) {
  const separator = route.indexOf(" ");
  const declaredMethod = route.slice(0, separator);
  const declaredPath = route.slice(separator + 1);
  return {
    method: declaredMethod === "ANY" ? "GET" : declaredMethod,
    path: declaredPath.replaceAll(":id", "example-id").replaceAll(":control", "home"),
  };
}
