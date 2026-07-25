import test from "node:test";
import assert from "node:assert/strict";
import { BenchmarkOracle, parseBenchmarkMarker } from "../src/oracle.js";

test("benchmark oracle parses markers and rejects stale revisions", () => {
  const oracle = new BenchmarkOracle();
  assert.deepEqual(parseBenchmarkMarker('noise SWIFT_SIM_BENCHMARK {"case":"baseline","value":"x","revision":1}'), {
    case: "baseline", value: "x", revision: 1,
  });
  oracle.ingest('SWIFT_SIM_BENCHMARK {"case":"baseline","value":"x","revision":1}');
  assert.throws(() => oracle.ingest('SWIFT_SIM_BENCHMARK {"case":"target","value":"new","revision":1}'), { code: "ORACLE_OUT_OF_ORDER" });
});

test("benchmark oracle permits baseline refreshes but rejects duplicate target markers", () => {
  const oracle = new BenchmarkOracle();
  oracle.ingest('SWIFT_SIM_BENCHMARK {"case":"baseline","value":"x","revision":1}');
  oracle.ingest('SWIFT_SIM_BENCHMARK {"case":"baseline","value":"x","revision":2}');
  oracle.ingest('SWIFT_SIM_BENCHMARK {"case":"target","value":"new","revision":3}');
  assert.throws(() => oracle.ingest('SWIFT_SIM_BENCHMARK {"case":"target","value":"new","revision":4}'), { code: "ORACLE_DUPLICATE" });
  assert.deepEqual(oracle.assertCurrent({ caseID: "target", value: "new" }), { case: "target", value: "new", revision: 3 });
});

test("benchmark oracle rejects malformed marker payloads", () => {
  assert.throws(() => parseBenchmarkMarker('SWIFT_SIM_BENCHMARK {"case":"x"}'), { code: "ORACLE_MALFORMED" });
});
