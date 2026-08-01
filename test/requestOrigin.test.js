import assert from "node:assert/strict";
import test from "node:test";
import { externalRequestBase } from "../mac-helper/src/requestOrigin.js";

test("Tailscale reverse-proxy requests preserve their external HTTPS origin", () => {
  const req = { headers: {} };
  const url = new URL("http://miguels-macbook-air.example.ts.net/pair");

  assert.equal(
    externalRequestBase(req, url),
    "https://miguels-macbook-air.example.ts.net"
  );
});

test("forwarded protocol is authoritative for a loopback proxy", () => {
  const req = {
    headers: { "x-forwarded-proto": "https" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const url = new URL("http://helper.example.com/pair");

  assert.equal(externalRequestBase(req, url), "https://helper.example.com");
});

test("a direct network peer cannot override the pairing protocol", () => {
  const req = {
    headers: { "x-forwarded-proto": "http" },
    socket: { remoteAddress: "100.100.100.25" },
  };
  const url = new URL("http://helper.example.com/pair");

  assert.equal(externalRequestBase(req, url), "https://helper.example.com");
});

test("local helper requests stay HTTP", () => {
  const req = { headers: {}, socket: { remoteAddress: "127.0.0.1" } };
  const url = new URL("http://127.0.0.1:47217/pair");

  assert.equal(externalRequestBase(req, url), "http://127.0.0.1:47217");
});
