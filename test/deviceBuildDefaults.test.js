import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DEVICE_BUILD_TTL_MINUTES,
  normalizeDeviceBuildTTLMinutes,
} from "../mac-helper/src/deviceBuildDefaults.js";

test("device build links default to two hours", () => {
  assert.equal(DEFAULT_DEVICE_BUILD_TTL_MINUTES, 120);
  assert.equal(normalizeDeviceBuildTTLMinutes(undefined), 120);
  assert.equal(normalizeDeviceBuildTTLMinutes("not-a-number"), 120);
});

test("device build TTL remains within the supported range", () => {
  assert.equal(normalizeDeviceBuildTTLMinutes(1), 5);
  assert.equal(normalizeDeviceBuildTTLMinutes("45"), 45);
  assert.equal(normalizeDeviceBuildTTLMinutes(300), 120);
});
