import assert from "node:assert/strict";
import test from "node:test";
import { createInfrastructureContainer } from "../mac-helper/src/infrastructure/runtimeContainer.js";
import type {
  InfrastructurePorts,
  LockLease,
  LockRequest,
  LogFields,
  Logger,
} from "../mac-helper/src/infrastructure/ports.js";

function fixtureLease(request: LockRequest): LockLease {
  return {
    path: request.path,
    ownerPath: `${request.path}/owner.json`,
    ownerNonce: "fixture",
    release: async () => undefined,
    releaseSync: () => undefined,
  };
}

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
      spawn: () => {
        throw new Error("not configured");
      },
      inspect: () => ({ state: "missing" }),
      terminate: () => undefined,
      waitForExit: async () => "exited",
    },
    atomicFileStore: {
      readText: async () => "",
      readTextSync: () => "",
      readJSON: async () => ({}),
      readJSONSync: () => ({}),
      writeText: async () => undefined,
      writeTextSync: () => undefined,
      writeJSON: async () => undefined,
      writeJSONSync: () => undefined,
      remove: async () => undefined,
      removeSync: () => undefined,
    },
    lockManager: {
      acquire: async (request) => fixtureLease(request),
      acquireSync: (request) => fixtureLease(request),
      withLock: async (request, operation) => {
        const lease = fixtureLease(request);
        try {
          return await operation(lease);
        } finally {
          await lease.release();
        }
      },
      withLockSync: (request, operation) => {
        const lease = fixtureLease(request);
        try {
          return operation(lease);
        } finally {
          lease.releaseSync();
        }
      },
    },
    runtimeJournalStore: {
      publish: async () => undefined,
      publishSync: () => undefined,
      read: async () => null,
      readSync: () => null,
      remove: async () => undefined,
      removeSync: () => undefined,
    },
    artifactStore: {
      resolveContained: (root, candidate) => `${root}/${candidate}`,
      createDirectory: async () => undefined,
      createDirectorySync: () => undefined,
      write: async () => undefined,
      writeSync: () => undefined,
      read: async () => new Uint8Array(),
      readSync: () => new Uint8Array(),
      removeTree: async () => undefined,
      removeTreeSync: () => undefined,
    },
    requestOriginPolicy: {
      evaluate: () => ({
        accepted: false,
        requestIsLoopback: true,
        forwardedHeadersTrusted: false,
        reason: "invalid-host",
      }),
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

test("infrastructure container requires every named port and freezes the aggregate", () => {
  const ports = fixturePorts();
  const container = createInfrastructureContainer(ports);

  assert.equal(Object.isFrozen(container), true);
  assert.notEqual(container, ports);
  assert.equal(container.clock.now().toISOString(), "1970-01-01T00:00:00.000Z");
  assert.deepEqual(
    container.processSupervisor.inspect({
      version: 2,
      pid: 42,
      processGroup: 42,
      startToken: "start",
      executable: "/usr/bin/true",
      command: "fixture",
      createdAt: "1970-01-01T00:00:00.000Z",
    }),
    { state: "missing" },
  );
});

test("infrastructure container fails closed when a dependency is absent", () => {
  const ports = fixturePorts();
  const incomplete = { ...ports, processSupervisor: undefined } as unknown as InfrastructurePorts;
  assert.throws(
    () => createInfrastructureContainer(incomplete),
    /Missing infrastructure port: processSupervisor/,
  );
});

test("infrastructure container rejects a named port with an incomplete method surface", () => {
  const ports = fixturePorts();
  const incomplete = {
    ...ports,
    atomicFileStore: { ...ports.atomicFileStore, writeJSONSync: undefined },
  } as unknown as InfrastructurePorts;
  assert.throws(
    () => createInfrastructureContainer(incomplete),
    /Infrastructure port atomicFileStore is missing method: writeJSONSync/,
  );
});
