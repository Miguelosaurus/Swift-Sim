import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("importing the helper HTTP boundary is inert until explicitly installed", async () => {
  const http = require("node:http");
  const originalCreateServer = http.createServer;
  const esmHttp = await import("node:http");
  const boundary = await import(
    `../mac-helper/src/helperHttpBoundaryPreload.js?explicit-install=${Date.now()}`
  );

  assert.strictEqual(http.createServer, originalCreateServer);
  assert.strictEqual(esmHttp.createServer, originalCreateServer);

  boundary.installHelperHttpBoundary();
  const installedCreateServer = http.createServer;
  assert.notStrictEqual(installedCreateServer, originalCreateServer);
  assert.strictEqual(esmHttp.createServer, installedCreateServer);

  boundary.installHelperHttpBoundary();
  assert.strictEqual(http.createServer, installedCreateServer);
  assert.strictEqual(esmHttp.createServer, installedCreateServer);
});
