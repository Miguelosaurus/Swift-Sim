import type { InfrastructurePorts } from "./ports.js";

const REQUIRED_PORTS = [
  { name: "commandRunner", methods: ["run", "runSync"] },
  {
    name: "processSupervisor",
    methods: ["spawn", "inspect", "terminate", "waitForExit"],
  },
  {
    name: "atomicFileStore",
    methods: [
      "readText",
      "readTextSync",
      "readJSON",
      "readJSONSync",
      "writeText",
      "writeTextSync",
      "writeJSON",
      "writeJSONSync",
      "remove",
      "removeSync",
    ],
  },
  {
    name: "lockManager",
    methods: ["acquire", "acquireSync", "withLock", "withLockSync"],
  },
  {
    name: "runtimeJournalStore",
    methods: ["publish", "publishSync", "read", "readSync", "remove", "removeSync"],
  },
  {
    name: "artifactStore",
    methods: [
      "resolveContained",
      "createDirectory",
      "createDirectorySync",
      "write",
      "writeSync",
      "read",
      "readSync",
      "removeTree",
      "removeTreeSync",
    ],
  },
  { name: "requestOriginPolicy", methods: ["evaluate"] },
  { name: "clock", methods: ["now", "monotonicMilliseconds", "sleep"] },
  { name: "idGenerator", methods: ["randomUUID", "randomToken"] },
  { name: "logger", methods: ["log", "child"] },
] as const satisfies readonly {
  name: keyof InfrastructurePorts;
  methods: readonly string[];
}[];

export type InfrastructureContainer = Readonly<InfrastructurePorts>;

/**
 * Creates the composition-root aggregate. Application services must receive
 * only the individual ports they use, never this complete container.
 */
export function createInfrastructureContainer(
  ports: InfrastructurePorts,
): InfrastructureContainer {
  for (const definition of REQUIRED_PORTS) {
    const candidate: unknown = ports[definition.name];
    if (!candidate || typeof candidate !== "object") {
      throw new TypeError(`Missing infrastructure port: ${definition.name}`);
    }
    const record = candidate as Readonly<Record<string, unknown>>;
    for (const method of definition.methods) {
      if (typeof record[method] !== "function") {
        throw new TypeError(
          `Infrastructure port ${definition.name} is missing method: ${method}`,
        );
      }
    }
  }
  return Object.freeze({ ...ports });
}
