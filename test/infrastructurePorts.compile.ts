import type {
  ProcessSupervisor,
  SpawnRequest,
} from "../mac-helper/src/infrastructure/ports.js";
import type { DeliveryProcessIdentity } from "../mac-helper/src/contracts/process.js";

declare const supervisor: ProcessSupervisor;

const workerRequest: SpawnRequest<"worker"> = {
  executable: "/usr/bin/true",
  args: [],
  processGroup: "new",
  journalPath: "/tmp/worker.json",
  role: "worker",
};
const worker = supervisor.spawn(workerRequest);
worker.record.command;

const manager = supervisor.spawn({
  executable: "/usr/bin/true",
  args: [],
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
