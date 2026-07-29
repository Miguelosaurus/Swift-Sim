import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { readJson } from "../mac-helper/src/http.js";
import { serveFile } from "../mac-helper/src/fileServer.js";


test("readJson preserves UTF-8 characters split across chunks", async () => {
  const payload = Buffer.from(JSON.stringify({ scheme: "Café 🚀" }));
  const rocket = payload.indexOf(Buffer.from("🚀"));
  const req = Readable.from([
    payload.subarray(0, rocket + 1),
    payload.subarray(rocket + 1, rocket + 3),
    payload.subarray(rocket + 3),
  ]);
  req.headers = {};
  assert.deepEqual(await readJson(req), { scheme: "Café 🚀" });
});


test("artifact streaming keeps an opened file readable after unlink", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-file-server-test-"));
  const path = join(directory, "app.ipa");
  const payload = Buffer.alloc(256 * 1024, 7);
  writeFileSync(path, payload);
  const server = createServer((_, res) => serveFile(res, path, {
    contentType: "application/octet-stream",
    filename: "app.ipa",
    notFound: (response, message) => {
      response.writeHead(404);
      response.end(message);
    },
  }));
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}`);
    unlinkSync(path);
    const received = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.deepEqual(received, payload);
  } finally {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
