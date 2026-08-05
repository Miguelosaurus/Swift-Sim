import assert from "node:assert/strict";
import test from "node:test";
import type { PairingCredentialRecord } from "../mac-helper/src/contracts/pairing.js";
import type { PairingShadowComparisonResult } from "../mac-helper/src/contracts/repository.js";
import { handlePairingFallbackRequest } from "../mac-helper/src/http/pairingFallbackHandler.js";
import { PairingCredentialShadowObserver } from "../mac-helper/src/persistence/pairingCredentialShadowObserver.js";

const CREDENTIAL: PairingCredentialRecord = Object.freeze({
  token: "pair-token",
  installationID: "installation-1",
  macName: "Test Mac",
  createdAt: "2026-08-05T16:00:00.000Z",
  updatedAt: "2026-08-05T16:01:00.000Z",
});

class ResponseRecorder {
  status = 0;
  headers: Record<string, string> = {};
  body = "";

  writeHead(status: number, headers: Record<string, string>) {
    this.status = status;
    this.headers = headers;
  }

  end(body = "") {
    this.body += body;
  }
}

test("credential shadow observer compares SQLite without changing legacy authority", () => {
  let compared:
    | {
        surface: "credential";
        key: string;
        legacy: PairingCredentialRecord;
        sqlite: PairingCredentialRecord | null;
      }
    | null = null;
  const expected: PairingShadowComparisonResult = {
    matched: true,
    surface: "credential",
    keyHash: "a".repeat(64),
    legacyProjectionHash: "b".repeat(64),
    sqliteProjectionHash: "b".repeat(64),
    evidence: null,
  };
  const observer = new PairingCredentialShadowObserver({
    pairingRepository: credentialRepository(CREDENTIAL),
    comparator: {
      compare(input) {
        compared = input;
        return expected;
      },
    },
  });

  assert.equal(observer.observeCredential(CREDENTIAL), expected);
  assert.deepEqual(compared, {
    surface: "credential",
    key: CREDENTIAL.installationID,
    legacy: CREDENTIAL,
    sqlite: CREDENTIAL,
  });
});

test("credential shadow observer contains repository and async reporter failures", async () => {
  const diagnostics: string[] = [];
  const observer = new PairingCredentialShadowObserver({
    pairingRepository: credentialRepository(null, new Error("database unavailable")),
    comparator: {
      compare() {
        return assert.fail("comparison must not run");
      },
    },
    reportError(error) {
      diagnostics.push(error.message);
      return Promise.reject(new Error("reporter failed"));
    },
  });

  assert.equal(observer.observeCredential(CREDENTIAL), null);
  await Promise.resolve();
  assert.deepEqual(diagnostics, ["Pairing credential shadow observation failed."]);
});

test("pairing handler defers observation until after authorized responses", async () => {
  const observed: unknown[] = [];
  const authorizedResponse = new ResponseRecorder();
  assert.equal(
    handlePairingFallbackRequest(
      {
        method: "GET",
        url: "/pair?token=pair-token",
        headers: { host: "mac.example" },
      },
      authorizedResponse,
      {
        current: () => CREDENTIAL,
        tokenMatches: (token: string) => token === CREDENTIAL.token,
      },
      { inspect: () => null },
      {
        evaluate: () => ({ valid: true, externalBaseURL: "https://mac.example" }),
      },
      {
        observeCredential(pairing) {
          assert.equal(authorizedResponse.status, 200);
          assert.match(authorizedResponse.body, /Connect to Test Mac/);
          assert.notEqual(pairing, CREDENTIAL);
          observed.push(pairing);
          return Promise.reject(new Error("asynchronous observer failure"));
        },
      },
    ),
    true,
  );
  assert.equal(authorizedResponse.status, 200);
  assert.deepEqual(observed, []);
  await waitForImmediate();
  assert.deepEqual(observed, [CREDENTIAL]);

  const unauthorizedResponse = new ResponseRecorder();
  assert.equal(
    handlePairingFallbackRequest(
      {
        method: "GET",
        url: "/pair?token=wrong",
        headers: { host: "mac.example" },
      },
      unauthorizedResponse,
      {
        current: () => CREDENTIAL,
        tokenMatches: () => false,
      },
      { inspect: () => null },
      {
        evaluate: () => ({ valid: true, externalBaseURL: "https://mac.example" }),
      },
      {
        observeCredential() {
          return assert.fail("unauthorized reads must not be observed");
        },
      },
    ),
    true,
  );
  assert.equal(unauthorizedResponse.status, 401);

  const expiredInviteResponse = new ResponseRecorder();
  assert.equal(
    handlePairingFallbackRequest(
      {
        method: "GET",
        url: "/pair?invite=expired-invite",
        headers: { host: "mac.example" },
      },
      expiredInviteResponse,
      {
        current: () => CREDENTIAL,
        tokenMatches: () => false,
      },
      { inspect: () => null },
      {
        evaluate: () => ({ valid: true, externalBaseURL: "https://mac.example" }),
      },
      {
        observeCredential() {
          return assert.fail("expired invitations must not be observed");
        },
      },
    ),
    true,
  );
  assert.equal(expiredInviteResponse.status, 410);
  await waitForImmediate();
  assert.deepEqual(observed, [CREDENTIAL]);

  const accessorResponse = new ResponseRecorder();
  const throwingAccessor = {
    get observeCredential(): never {
      throw new Error("observer accessor failed");
    },
  };
  assert.equal(
    handlePairingFallbackRequest(
      {
        method: "GET",
        url: "/pair?token=pair-token",
        headers: { host: "mac.example" },
      },
      accessorResponse,
      {
        current: () => CREDENTIAL,
        tokenMatches: () => true,
      },
      { inspect: () => null },
      {
        evaluate: () => ({ valid: true, externalBaseURL: "https://mac.example" }),
      },
      throwingAccessor,
    ),
    true,
  );
  assert.equal(accessorResponse.status, 200);
  assert.match(accessorResponse.body, /Connect to Test Mac/);

  const invitationResponse = new ResponseRecorder();
  assert.equal(
    handlePairingFallbackRequest(
      {
        method: "GET",
        url: "/pair?invite=active-invite",
        headers: { host: "mac.example" },
      },
      invitationResponse,
      {
        current: () => CREDENTIAL,
        tokenMatches: () => false,
      },
      {
        inspect: () => ({
          claimed: false,
          expiresAt: "2026-08-05T16:05:00.000Z",
        }),
      },
      {
        evaluate: () => ({ valid: true, externalBaseURL: "https://mac.example" }),
      },
      {
        observeCredential(pairing) {
          assert.equal(invitationResponse.status, 200);
          assert.match(invitationResponse.body, /active-invite/);
          assert.notEqual(pairing, CREDENTIAL);
          observed.push(pairing);
          throw new Error("synchronous observer failure");
        },
      },
    ),
    true,
  );
  assert.equal(invitationResponse.status, 200);
  assert.deepEqual(observed, [CREDENTIAL]);
  await waitForImmediate();
  assert.deepEqual(observed, [CREDENTIAL, CREDENTIAL]);
});

function credentialRepository(
  credential: PairingCredentialRecord | null,
  failure: Error | null = null,
) {
  return {
    getCredential() {
      if (failure) throw failure;
      return credential;
    },
  };
}

function waitForImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
