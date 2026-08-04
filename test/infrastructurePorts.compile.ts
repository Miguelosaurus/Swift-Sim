import type {
  ProcessSupervisor,
  RequestOriginPolicy,
  SpawnRequest,
} from "../mac-helper/src/infrastructure/ports.js";
import type { DeliveryProcessIdentity } from "../mac-helper/src/contracts/process.js";

declare const supervisor: ProcessSupervisor;
declare const originPolicy: RequestOriginPolicy;

const emptyEnvironment = { inherit: [], overrides: {}, unset: [] } as const;
const workerRequest: SpawnRequest<"worker"> = {
  executable: "/usr/bin/true",
  args: [],
  environment: emptyEnvironment,
  processGroup: "new",
  journalPath: "/tmp/worker.json",
  role: "worker",
};
const worker = supervisor.spawn(workerRequest);
worker.record.command;

const manager = supervisor.spawn({
  executable: "/usr/bin/true",
  args: [],
  environment: emptyEnvironment,
  processGroup: "inherit",
  journalPath: "/tmp/manager.json",
  role: "manager",
});
manager.record.commandFragments;
// @ts-expect-error Delivery identities do not prove a process-group identity.
manager.record.processGroup;

const deliveryIdentity: DeliveryProcessIdentity = {
  pid: 42,
  startedAt: "start",
  commandFragments: ["manager"],
};
// @ts-expect-error Group termination requires a group-owned worker or live-engine record.
supervisor.terminate({
  record: deliveryIdentity,
  signal: "SIGKILL",
  graceMs: 0,
  terminateGroup: true,
});

supervisor.terminate({
  record: deliveryIdentity,
  signal: "SIGTERM",
  graceMs: 1_000,
  terminateGroup: false,
});

originPolicy.evaluate({
  socketRemoteAddress: "127.0.0.1",
  requestProtocol: "http:",
  hostHeader: "127.0.0.1:47217",
});

originPolicy.evaluate({
  socketRemoteAddress: "127.0.0.1",
  requestProtocol: "http:",
  hostHeader: "127.0.0.1:47217",
  // @ts-expect-error Proxy trust is derived from the socket identity, never supplied by callers.
  trustProxy: true,
});
