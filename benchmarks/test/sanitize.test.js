import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeError, sanitizeValue } from "../src/sanitize.js";

test("redacts paths, identifiers, tokens, and source-bearing fields", () => {
  const value = sanitizeValue({
    path: "/Users/miguel/Documents/Swift-Sim/Card.swift",
    device: "01234567-89AB-CDEF-0123-456789ABCDEF",
    team: "AB12CD34EF",
    url: "https://example.ts.net/d/build?token=secret",
    source: "struct Secret {}",
  });
  assert.equal(value.path, "<home>/Documents/Swift-Sim/Card.swift");
  assert.equal(value.device, "<device-id>");
  assert.equal(value.team, "<team-id>");
  assert.match(value.url, /<tailnet-host>\/d\/build\?token=<redacted>/);
  assert.equal(value.source, "<omitted>");
});

test("sanitizes process errors", () => {
  assert.equal(sanitizeError(new Error("/Users/miguel/.swift-sim/helper.log")), "<swift-sim-state>");
});
