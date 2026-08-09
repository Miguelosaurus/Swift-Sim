import assert from "node:assert/strict";
import test from "node:test";
import { createHelperControlApplicationService } from "../mac-helper/src/http/helperControlApplicationService.js";

test("helper control service validates its complete dependency surface", () => {
  assert.throws(() => createHelperControlApplicationService({}), /requires pairingTokenMatches/);
});

test("health and association preserve public projections without private dependencies", async () => {
  const service = createHelperControlApplicationService(dependencies());
  assert.deepEqual(await service.execute({ operation: "health", url: url() }), {
    kind: "ok",
    status: 200,
    body: { ok: true, helper: "swift-sim-helper" },
  });
  assert.deepEqual(await service.execute({ operation: "association", url: url() }), {
    kind: "ok",
    status: 200,
    body: { applinks: { apps: [] } },
  });
});

for (const operation of ["serve-sim", "transports"]) {
  test(`${operation} authorizes before inspection`, async () => {
    let inspected = false;
    const service = createHelperControlApplicationService(
      dependencies({
        pairingTokenMatches: () => false,
        inspectServeSim: async () => {
          inspected = true;
        },
        inspectTransports: async () => {
          inspected = true;
        },
      }),
    );
    assert.deepEqual(await service.execute({ operation, request: {}, url: url() }), {
      kind: "unauthorized",
    });
    assert.equal(inspected, false);
  });
}

test("transport and pairing query routes preserve projections and query-only authorization", async () => {
  const queryTokens = [];
  const service = createHelperControlApplicationService(
    dependencies({
      pairingTokenMatchesQuery: (token) => {
        queryTokens.push(token);
        return token === "secret";
      },
    }),
  );
  assert.deepEqual(await service.execute({ operation: "transports", request: {}, url: url() }), {
    kind: "ok",
    status: 200,
    body: { default: "automatic", transports: [{ id: "serve-sim" }] },
  });
  assert.deepEqual(await service.execute({ operation: "pairing-status", url: url("wrong") }), {
    kind: "unauthorized",
  });
  assert.deepEqual(
    await service.execute({ operation: "pairing-status", url: new URL("http://127.0.0.1/") }),
    { kind: "unauthorized" },
  );
  assert.deepEqual(await service.execute({ operation: "pairing-status", url: url("secret") }), {
    kind: "ok",
    status: 200,
    body: { paired: true },
  });
  assert.deepEqual(
    await service.execute({
      operation: "pairing-rotate",
      url: new URL(
        "http://127.0.0.1/api/pairing/rotate?token=secret&remoteBaseUrl=https%3A%2F%2Fmac.example",
      ),
    }),
    {
      kind: "ok",
      status: 200,
      body: { macName: "Mac", links: { base: "https://mac.example", token: "rotated" } },
    },
  );
  assert.deepEqual(queryTokens, ["wrong", null, "secret", "secret"]);
});

test("pairing query authorization denies before reading or rotating pairing state", async () => {
  let statusReads = 0;
  let rotations = 0;
  const service = createHelperControlApplicationService(
    dependencies({
      pairingTokenMatchesQuery: () => false,
      pairingStatus: () => {
        statusReads += 1;
      },
      rotatePairing: () => {
        rotations += 1;
      },
    }),
  );
  assert.deepEqual(await service.execute({ operation: "pairing-status", url: url("wrong") }), {
    kind: "unauthorized",
  });
  assert.deepEqual(await service.execute({ operation: "pairing-rotate", url: url("wrong") }), {
    kind: "unauthorized",
  });
  assert.equal(statusReads, 0);
  assert.equal(rotations, 0);
});

test("pairing claim preserves bearer precedence and stable failure statuses", async () => {
  const claims = [];
  const service = createHelperControlApplicationService(
    dependencies({
      claimToken: () => "bearer-invite",
      claimInvite: (invite, nonce, pairing) => {
        claims.push({ invite, nonce, pairing });
        return { ok: true, pairing, expiresAt: "2026-08-09T16:00:00.000Z" };
      },
    }),
  );
  assert.deepEqual(
    await service.execute({
      operation: "pairing-claim",
      request: {},
      url: url(),
      readInput: async () => ({ invite: "body-invite", clientNonce: "nonce" }),
    }),
    {
      kind: "ok",
      status: 200,
      body: {
        token: "secret",
        installationID: "installation-1",
        macName: "Mac",
        expiresAt: "2026-08-09T16:00:00.000Z",
      },
    },
  );
  assert.deepEqual(claims, [
    {
      invite: "bearer-invite",
      nonce: "nonce",
      pairing: { token: "secret", installationID: "installation-1", macName: "Mac" },
    },
  ]);

  for (const [code, status] of [
    ["malformed", 400],
    ["consumed", 409],
    ["expired", 410],
  ]) {
    const failing = createHelperControlApplicationService(
      dependencies({
        claimInvite: () => ({ ok: false, code }),
      }),
    );
    const outcome = await failing.execute({
      operation: "pairing-claim",
      request: {},
      url: url(),
      readInput: async () => ({ invite: "invite", clientNonce: "nonce" }),
    });
    assert.equal(outcome.status, status);
    assert.deepEqual(outcome.body, { error: `Pairing invitation ${code}.` });
  }
});

test("pairing claim preserves raw body values for the invitation store", async () => {
  const claims = [];
  const service = createHelperControlApplicationService(
    dependencies({
      claimInvite: (invite, nonce) => {
        claims.push({ invite, nonce });
        return { ok: false, code: "malformed" };
      },
    }),
  );
  await service.execute({
    operation: "pairing-claim",
    request: {},
    url: url(),
    readInput: async () => ({ invite: 42, clientNonce: { invalid: true } }),
  });
  assert.deepEqual(claims, [{ invite: 42, nonce: { invalid: true } }]);
});

function dependencies(overrides = {}) {
  const pairing = { token: "secret", installationID: "installation-1", macName: "Mac" };
  return {
    pairingTokenMatches: () => true,
    association: () => ({ applinks: { apps: [] } }),
    inspectServeSim: async () => ({ running: true }),
    defaultTransport: () => "automatic",
    inspectTransports: async () => [{ id: "serve-sim" }],
    pairingTokenMatchesQuery: (token) => token === "secret",
    pairingStatus: () => ({ paired: true }),
    currentPairing: () => pairing,
    claimToken: () => "",
    claimInvite: () => ({ ok: true, pairing, expiresAt: "2026-08-09T16:00:00.000Z" }),
    rotatePairing: () => ({ ...pairing, token: "rotated" }),
    pairingLinks: (value, base) => ({ base, token: value.token }),
    ...overrides,
  };
}

function url(token = "secret") {
  return new URL(`http://127.0.0.1/?token=${token}`);
}
