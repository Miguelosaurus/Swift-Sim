import assert from "node:assert/strict";
import test from "node:test";
import { createPairingPageApplicationService } from "../mac-helper/src/http/pairingPageApplicationService.js";

const pairing = {
  installationID: "mac-1",
  macName: "Desk Mac",
  token: "stored-token",
};

test("pairing page service renders a valid one-time invitation without consulting the pairing token", async () => {
  const calls = [];
  let rendered;
  const service = createPairingPageApplicationService({
    currentPairing: () => ({ ...pairing }),
    inspectInvite: (invite, current) => {
      calls.push(["inspect", invite, current]);
      return { claimed: false, expiresAt: "2026-08-10T19:00:00.000Z" };
    },
    tokenMatches: () => {
      throw new Error("token matcher must not run for invite pages");
    },
    requestBase: (request, url) => {
      calls.push(["base", request, url.pathname]);
      return "https://desk-mac.tail.example";
    },
    renderPage: (input) => {
      rendered = input;
      return "<html>invite</html>";
    },
  });
  const request = { id: "request" };
  const outcome = await service.execute({
    request,
    url: new URL("http://127.0.0.1/pair?invite=invite-1&token=ignored"),
  });

  assert.equal(outcome.kind, "text");
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body, "<html>invite</html>");
  assert.equal(outcome.contentType, "text/html; charset=utf-8");
  assert.deepEqual(outcome.headers, expectedHeaders());
  assert.deepEqual(rendered, {
    pairing: {
      ...pairing,
      invite: "invite-1",
      expiresAt: "2026-08-10T19:00:00.000Z",
    },
    base: "https://desk-mac.tail.example",
  });
  assert.equal(calls[0][0], "inspect");
  assert.equal(calls[0][1], "invite-1");
  assert.deepEqual(calls[0][2], pairing);
  assert.deepEqual(calls[1], ["base", request, "/pair"]);
});

for (const invitation of [null, { claimed: true, expiresAt: "2026-08-10T19:00:00.000Z" }]) {
  test(`pairing page service rejects ${invitation ? "claimed" : "missing"} invitations without rendering`, async () => {
    let rendered = false;
    let based = false;
    const service = createPairingPageApplicationService({
      currentPairing: () => ({ ...pairing }),
      inspectInvite: () => invitation,
      tokenMatches: () => {
        throw new Error("token matcher must not run for invite pages");
      },
      requestBase: () => {
        based = true;
        return "https://unexpected.example";
      },
      renderPage: () => {
        rendered = true;
        return "unexpected";
      },
    });
    assert.deepEqual(
      await service.execute({
        request: {},
        url: new URL("http://127.0.0.1/pair?invite=expired"),
      }),
      {
        kind: "bad-request",
        status: 410,
        message: "Pairing invitation expired or already used.",
      },
    );
    assert.equal(based, false);
    assert.equal(rendered, false);
  });
}

test("pairing page service preserves token authorization and the exact presented token", async () => {
  let checkedToken;
  let rendered;
  const service = createPairingPageApplicationService({
    currentPairing: () => ({ ...pairing }),
    inspectInvite: () => {
      throw new Error("invite store must not run for token pages");
    },
    tokenMatches: (token) => {
      checkedToken = token;
      return token === "presented-token";
    },
    requestBase: () => "https://desk-mac.tail.example",
    renderPage: (input) => {
      rendered = input;
      return "<html>token</html>";
    },
  });
  const outcome = await service.execute({
    request: {},
    url: new URL("http://127.0.0.1/pair?token=presented-token"),
  });
  assert.equal(checkedToken, "presented-token");
  assert.equal(outcome.kind, "text");
  assert.deepEqual(rendered, {
    pairing: { ...pairing, token: "presented-token" },
    base: "https://desk-mac.tail.example",
  });
});

test("pairing page service denies a bad or missing token before origin projection or rendering", async () => {
  for (const href of ["http://127.0.0.1/pair?token=wrong", "http://127.0.0.1/pair"]) {
    let based = false;
    let rendered = false;
    let currentReads = 0;
    const service = createPairingPageApplicationService({
      currentPairing: () => {
        currentReads += 1;
        return { ...pairing };
      },
      inspectInvite: () => {
        throw new Error("invite store must not run");
      },
      tokenMatches: () => false,
      requestBase: () => {
        based = true;
        return "https://unexpected.example";
      },
      renderPage: () => {
        rendered = true;
        return "unexpected";
      },
    });
    assert.deepEqual(await service.execute({ request: {}, url: new URL(href) }), {
      kind: "unauthorized",
    });
    assert.equal(currentReads, 1);
    assert.equal(based, false);
    assert.equal(rendered, false);
  }
});

test("pairing page service validates every dependency at construction", () => {
  const dependencies = {
    currentPairing: () => pairing,
    inspectInvite: () => null,
    tokenMatches: () => true,
    requestBase: () => "https://example.test",
    renderPage: () => "html",
  };
  for (const name of Object.keys(dependencies)) {
    assert.throws(
      () => createPairingPageApplicationService({ ...dependencies, [name]: undefined }),
      new RegExp(`requires ${name}`),
    );
  }
});

function expectedHeaders() {
  return {
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}
