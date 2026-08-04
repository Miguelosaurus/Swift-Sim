import assert from "node:assert/strict";
import test from "node:test";
import { createInfrastructureContainer } from "../mac-helper/src/infrastructure/runtimeContainer.js";
import type {
  InfrastructurePorts,
  LogFields,
  Logger,
} from "../mac-helper/src/infrastructure/ports.js";

function fixturePorts(): InfrastructurePorts {
  const logger: Logger = {
    log: () => undefined,
    child: (_fields: LogFields) => logger,
  };

  return {
    commandRunner: {
      run: async () => ({ code: 0, stdout: "", stderr: "" }),
      runSync: () => ({ code: 0, stdout: "", stderr: "" }),
    },
    processSupervisor: {
      spawn: async () => {
        throw new Error("not configured");
      },
      inspect: async () => ({ state: "missing" }),
      terminate: async () => undefined,
    },
    atomicFileStore: {
      readText: async () => "",
      readJSON: async () => ({}),
      writeText: async () => undefined,
      writeJSON: async () => undefined,
      remove: async () => undefined,
    },
    lockManager: {
      acquire: async (request) => ({
        path: request.path,
        ownerPath: `${request.path}/owner.json`,
        ownerNonce: "fixture",
        release: async () => undefined,
      }),
      withLock: async (request, operation) => {
        const lease = {
          path: request.path,
          ownerPath: `${request.path}/owner.json`,
          ownerNonce: "fixture",
          release: async () => undefined,
        };
        try {
          return await operation(lease);
        } finally {
          await lease.release();
        }
      },
    },
    runtimeJournalStore: {
      publish: async () => undefined,
      read: async () => null,
      remove: async () => undefined,
    },
    artifactStore: {
      resolveContained: (root, candidate) => `${root}/${candidate}`,
      createDirectory: async () => undefined,
      write: async () => undefined,
      read: async () => new Uint8Array(),
      removeTree: async () => undefined,
    },
    requestOriginPolicy: {
      evaluate: () => ({ allowed: false, reason: "invalid-host" }),
    },
    clock: {
      now: () => new Date(0),
      monotonicMilliseconds: () => 0,
      sleep: async () => undefined,
    },
    idGenerator: {
      randomUUID: () => "00000000-0000-4000-8000-000000000000",
      randomToken: () => "token",
    },
    logger,
  };
}

test("infrastructure container requires every named port and freezes the aggregate", async () => {
  const ports = fixturePorts();
  const container = createInfrastructureContainer(ports);

  assert.equal(Object.isFrozen(container), true);
  assert.notEqual(container, ports);
  assert.equal(container.clock.now().toISOString(), "1970-01-01T00:00:00.000Z");
  assert.deepEqual(await container.processSupervisor.inspect({
    version: 2,
    pid: 42,
    processGroup: 42,
    startToken: "start",
    executable: "/usr/bin/true",
    command: "fixture",
    createdAt: "1970-01-01T00:00:00.000Z",
  }), { state: "missing" });
});

test("infrastructure container fails closed when a dependency is absent", () => {
  const ports = fixturePorts();
  const incomplete = { ...ports, processSupervisor: undefined } as unknown as InfrastructurePorts;
  assert.throws(
    () => createInfrastructureContainer(incomplete),
    /Missing infrastructure port: processSupervisor/,
  );
});
