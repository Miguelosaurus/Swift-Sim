import { basename } from "node:path";

const script = basename(String(process.argv[1] || ""));

if (script === "swift-sim-helper.js") {
  await import("./lockOwnershipPreload.js");
  await import("./ownedWorkerPreload.js");
  await import("./runtimeHealthPreload.js");
  await import("./deviceBuildCapabilityBoundaryPreload.js");
  await import("./helperHttpBoundaryPreload.js");
  const { installCompatibleHelperHealthFetchBoundary } = await import("./cliRuntimeBoundary.js");
  const { installSwiftSimChildRuntimeBoundary } = await import("./swiftSimChildRuntimeBoundary.js");
  const { installRenewalShutdownGuard } = await import("./renewalShutdownPreload.js");
  installCompatibleHelperHealthFetchBoundary();
  installSwiftSimChildRuntimeBoundary();
  installRenewalShutdownGuard();
} else if (script === "swift-sim-device-gateway.js") {
  await import("./lockOwnershipPreload.js");
  await import("./runtimeHealthPreload.js");
} else if (script === "swift-sim-device-delivery.js") {
  const { installGatewayHealthFetchBoundary } = await import("./gatewayHealthFetchBoundary.js");
  installGatewayHealthFetchBoundary();
}
