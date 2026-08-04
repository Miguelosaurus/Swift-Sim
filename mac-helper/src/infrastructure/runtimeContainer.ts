import type { InfrastructurePorts } from "./ports.js";

const REQUIRED_PORTS = [
  "commandRunner",
  "processSupervisor",
  "atomicFileStore",
  "lockManager",
  "runtimeJournalStore",
  "artifactStore",
  "requestOriginPolicy",
  "clock",
  "idGenerator",
  "logger",
] as const satisfies readonly (keyof InfrastructurePorts)[];

export type InfrastructureContainer = Readonly<InfrastructurePorts>;

/**
 * Creates the composition-root aggregate. This validates only dependency
 * presence; each port remains responsible for its own runtime boundary checks.
 */
export function createInfrastructureContainer(
  ports: InfrastructurePorts,
): InfrastructureContainer {
  for (const name of REQUIRED_PORTS) {
    if (!ports[name] || typeof ports[name] !== "object") {
      throw new TypeError(`Missing infrastructure port: ${name}`);
    }
  }
  return Object.freeze({ ...ports });
}
