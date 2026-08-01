import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const requestFence = readFileSync(
  "Companion/SwiftSimCompanion/SwiftSimLatestRequestProtocol.m",
  "utf8"
);

test("newer visible selection timestamps create a fresh authority epoch", () => {
  assert.match(requestFence, /@property\(nonatomic\) NSTimeInterval selectionTimestamp/);
  assert.match(requestFence, /SwiftSimActiveSelectionTimestamp/);
  assert.match(
    requestFence,
    /newerVisibleSelection[\s\S]*selectionTimestamp > SwiftSimActiveSelectionTimestamp/
  );
  assert.match(
    requestFence,
    /authorized && \(!activeMatches \|\| newerVisibleSelection\)[\s\S]*SwiftSimActiveSessionEpoch \+= 1/
  );
});

test("explicit reopen ordering is independent of the old stream stop wall clock", () => {
  assert.match(requestFence, /SwiftSimClosedSelectionTimestamp/);
  assert.match(
    requestFence,
    /selectionTimestamp > SwiftSimClosedSelectionTimestamp/
  );
  assert.doesNotMatch(
    requestFence,
    /explicitlyReopened[\s\S]{0,160}SwiftSimClosedSelectionAt/
  );
  assert.match(
    requestFence,
    /SwiftSimClosedSelectionTimestamp = SwiftSimActiveSelectionTimestamp/
  );
});

test("metadata refresh timestamps are adopted without replacing the visible epoch", () => {
  assert.match(
    requestFence,
    /currentlyActive && self\.selectionTimestamp > SwiftSimActiveSelectionTimestamp[\s\S]*SwiftSimActiveSelectionTimestamp = self\.selectionTimestamp/
  );
  assert.match(
    requestFence,
    /kind == SwiftSimRequestKindSessionLogs \|\| kind == SwiftSimRequestKindSessionInput[\s\S]*self\.selectionTimestamp > SwiftSimActiveSelectionTimestamp/
  );
});

test("only the authoritative request generation may close selection", () => {
  assert.match(requestFence, /currentLaneGeneration[\s\S]*closesSelection/);
  assert.match(
    requestFence,
    /SwiftSimActiveSessionEpoch == self\.sessionEpoch/
  );
});
