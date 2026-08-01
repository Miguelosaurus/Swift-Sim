import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const fixtureRoot = join(repositoryRoot, "benchmarks", "fixtures", "sources");
const corpusRoot = join(repositoryRoot, "benchmarks", "corpora", "mechanisms");
const mutationRoot = join(corpusRoot, "mutations");
const sourcePath = "MechanismApp/MechanismCoverageScreen.swift";

const source = `import Foundation
import Observation
import SwiftUI
import UIKit

struct MechanismCoverageScreen: View {
    @State private var model = MechanismObservableModel()
    @MechanismStringWrapper private var wrappedMarker = "wrapper-01"
    private let storedMechanismTitle = "Mechanisms"

    var body: some View {
        VStack(spacing: 4) {
            Text(storedMechanismTitle)
            BenchmarkMarkerView(value: "mechanism-baseline")
            BenchmarkMarkerView(caseID: "protocol-default", value: MechanismProtocolConformer().protocolValue())
            BenchmarkMarkerView(caseID: "actor-method", value: MechanismCoverageActor.value())
            MechanismExtensionCoverageView()
            BenchmarkMarkerView(caseID: "observation-computed", value: model.displayValue)
            BenchmarkMarkerView(caseID: "property-wrapper-getter", value: wrappedMarker)
            BenchmarkMarkerView(caseID: "parameterized-helper", value: MechanismParameterHelper.label(for: "input"))
            BenchmarkMarkerView(caseID: "initializer-body", value: MechanismInitializerProbe(value: "input").value)
            BenchmarkMarkerView(caseID: "accessor-getter", value: MechanismAccessorProbe().value)
            BenchmarkMarkerView(caseID: "subscript-body", value: MechanismSubscriptProbe()[0])
            BenchmarkMarkerView(caseID: "generic-helper", value: MechanismGenericProbe.label(7))
            BenchmarkMarkerView(caseID: "uikit-display-value", value: MechanismUIKitProbe.displayValue())
            BenchmarkMarkerView(caseID: "modifier-host", value: "modifier-host")
                .modifier(MechanismCoverageModifier())
            MechanismUIKitProbe(marker: MechanismUIKitProbe.displayValue())
            MechanismAsyncProbeView()
        }
    }
}

protocol MechanismCoverageProtocol {
    func protocolValue() -> String
}

struct MechanismProtocolConformer: MechanismCoverageProtocol {}

extension MechanismCoverageProtocol {
    func protocolValue() -> String { "protocol-01" }
}

actor MechanismCoverageActor {
    nonisolated static func value() -> String { "actor-01" }
}

struct MechanismExtensionCoverageView: View {}

extension MechanismExtensionCoverageView {
    var body: some View {
        BenchmarkMarkerView(caseID: "extension-view-body", value: "extension-01")
    }
}

struct MechanismCoverageModifier: ViewModifier {
    func body(content: Content) -> some View {
        content.overlay(
            BenchmarkMarkerView(caseID: "modifier-body", value: "modifier-01")
        )
    }
}

@Observable
final class MechanismObservableModel {
    var displayValue: String { "observation-01" }
}

@propertyWrapper
struct MechanismStringWrapper {
    private var storage: String

    init(wrappedValue: String) {
        storage = wrappedValue
    }

    var wrappedValue: String { storage }
}

struct MechanismParameterHelper {
    static func label(for value: String) -> String { "parameter-01" }
}

struct MechanismInitializerProbe {
    let value: String

    init(value: String) {
        self.value = "initializer-01"
    }
}

struct MechanismAccessorProbe {
    private let storage = "accessor-storage"

    var value: String {
        get { "accessor-01" }
        set { _ = newValue }
    }
}

struct MechanismSubscriptProbe {
    subscript(index: Int) -> String { "subscript-01" }
}

struct MechanismGenericProbe {
    static func label<T: CustomStringConvertible>(_ value: T) -> String { "generic-01" }
}

struct MechanismAsyncProbe {
    static func value(_ input: String) async throws -> String { "async-01" }
}

struct MechanismAsyncProbeView: View {
    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .task {
                let value = (try? await MechanismAsyncProbe.value("input")) ?? "async-error"
                BenchmarkMarker.emit(caseID: "async-parameterized", value: value)
            }
    }
}

struct MechanismUIKitProbe: UIViewRepresentable {
    var marker: String

    static func displayValue() -> String { "uikit-display-01" }

    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.text = marker
        return label
    }

    func updateUIView(_ uiView: UILabel, context: Context) {
        uiView.text = marker
        BenchmarkMarker.emit(caseID: "uikit-update-view", value: "uikit-update-01")
    }
}

// mechanism-import-slot
`;

const hotDefinitions = [
  ["protocol-default", "protocol-default-implementation", '"protocol-01"', '"protocol-01-edited"', "protocol-01-edited"],
  ["actor-method", "actor-implementation", '"actor-01"', '"actor-01-edited"', "actor-01-edited"],
  ["extension-view-body", "extension-view-body", '"extension-01"', '"extension-01-edited"', "extension-01-edited"],
  ["modifier-body", "view-modifier-body", '"modifier-01"', '"modifier-01-edited"', "modifier-01-edited"],
  ["observation-computed", "observation-computed-property", '"observation-01"', '"observation-01-edited"', "observation-01-edited"],
  ["property-wrapper-getter", "property-wrapper-body", "var wrappedValue: String { storage }", 'var wrappedValue: String { "wrapper-01-edited" }', "wrapper-01-edited"],
  ["parameterized-helper", "parameterized-function", '"parameter-01"', '"parameter-01-edited"', "parameter-01-edited"],
  ["initializer-body", "initializer-body", 'self.value = "initializer-01"', 'self.value = "initializer-01-edited"', "initializer-01-edited"],
  ["accessor-getter", "accessor-getter", 'get { "accessor-01" }', 'get { "accessor-01-edited" }', "accessor-01-edited"],
  ["subscript-body", "subscript-body", 'subscript(index: Int) -> String { "subscript-01" }', 'subscript(index: Int) -> String { "subscript-01-edited" }', "subscript-01-edited"],
  ["generic-helper", "generic-function", 'static func label<T: CustomStringConvertible>(_ value: T) -> String { "generic-01" }', 'static func label<T: CustomStringConvertible>(_ value: T) -> String { "generic-01-edited" }', "generic-01-edited"],
  ["async-parameterized", "async-parameterized-function", 'static func value(_ input: String) async throws -> String { "async-01" }', 'static func value(_ input: String) async throws -> String { "async-01-edited" }', "async-01-edited"],
  ["uikit-display-value", "uikit-bridge-configuration", '"uikit-display-01"', '"uikit-display-01-edited"', "uikit-display-01-edited"],
  ["uikit-update-view", "uikit-update-implementation", 'value: "uikit-update-01"', 'value: "uikit-update-01-edited"', "uikit-update-01-edited"],
];

const rebuildDefinitions = [
  ["mechanism-stored-property", "stored-property", 'private let storedMechanismTitle = "Mechanisms"', 'private let storedMechanismTitle = "Updated mechanisms"'],
  ["mechanism-signature", "signature-change", "static func label(for value: String)", "static func label(for value: String, suffix: String)"],
  ["mechanism-import", "import-change", "// mechanism-import-slot", "import MapKit"],
];

export function generateMechanismCorpus() {
  writeFixture(sourcePath, source);
  mkdirSync(mutationRoot, { recursive: true });
  const cases = [
    ...hotDefinitions.map(([id, category, beforeToken, afterToken, oracle]) =>
      makeCase({ id, category, expectedLane: "hot-reload", beforeToken, afterToken, oracle })),
    ...rebuildDefinitions.map(([id, category, beforeToken, afterToken]) =>
      makeCase({ id, category, expectedLane: "build-device", beforeToken, afterToken })),
  ];
  const corpus = {
    schemaVersion: 1,
    corpusVersion: "mechanisms-2",
    fixtureRevision: "mechanisms-fixture-2",
    metadata: {
      totalCases: cases.length,
      expectedHotReload: cases.filter((value) => value.expectedLane === "hot-reload").length,
      expectedRebuild: cases.filter((value) => value.expectedLane === "build-device").length,
      authoringErrors: 0,
      multiFileOperations: 0,
      smokeHotCases: cases.filter((value) => value.smoke).length,
    },
    cases,
  };
  mkdirSync(corpusRoot, { recursive: true });
  writeFileSync(join(corpusRoot, "corpus.json"), `${JSON.stringify(corpus, null, 2)}\n`, { mode: 0o644 });
  return corpus;
}

function makeCase({ id, category, expectedLane, beforeToken, afterToken, oracle }) {
  const beforeLine = findLine(source, beforeToken);
  let afterLine = beforeLine.replace(beforeToken, afterToken);
  if (expectedLane === "hot-reload" && beforeLine.includes(`caseID: "${id}"`)) {
    afterLine = afterLine.replace(`value: "${id}"`, `value: "${oracle}"`);
  }
  if (beforeLine === afterLine) throw new Error(`No mutation target for ${id}.`);
  const after = replaceLine(source, beforeLine, afterLine);
  const mutationName = `${id}.patch`;
  writeFileSync(join(mutationRoot, mutationName), `${makePatch(sourcePath, source, after)}\n`, { mode: 0o644 });
  return {
    id,
    workload: "MechanismApp",
    category,
    validity: "valid",
    expectedLane,
    ...(expectedLane === "hot-reload" ? {
      confirmationPolicy: "interposed-function",
      oracle: { case: id, value: oracle },
      smoke: true,
    } : {}),
    mutation: `mutations/${mutationName}`,
    baselineHashes: { [sourcePath]: sha256(source) },
  };
}

function makePatch(path, before, after) {
  const beforeLines = before.replace(/\n$/, "").split("\n");
  const afterLines = after.replace(/\n$/, "").split("\n");
  let first = 0;
  while (first < beforeLines.length && first < afterLines.length && beforeLines[first] === afterLines[first]) first += 1;
  let lastBefore = beforeLines.length - 1;
  let lastAfter = afterLines.length - 1;
  while (lastBefore >= first && lastAfter >= first && beforeLines[lastBefore] === afterLines[lastAfter]) {
    lastBefore -= 1;
    lastAfter -= 1;
  }
  let contextStart = first;
  while (contextStart > 0 && beforeLines[contextStart - 1].trim() === "") contextStart -= 1;
  if (contextStart > 0) contextStart -= 1;
  const leadingCount = first - contextStart;
  let trailingContextEnd = lastBefore + 1;
  while (trailingContextEnd < beforeLines.length && beforeLines[trailingContextEnd].trim() === "") trailingContextEnd += 1;
  const trailingLines = trailingContextEnd - lastBefore;
  const hasTrailingContext = trailingContextEnd < beforeLines.length
    && lastAfter + trailingLines < afterLines.length
    && beforeLines[trailingContextEnd] === afterLines[lastAfter + trailingLines]
    && beforeLines[trailingContextEnd] !== "";
  const lines = [];
  for (let index = contextStart; index < first; index += 1) lines.push(` ${beforeLines[index]}`);
  for (let index = first; index <= lastBefore; index += 1) lines.push(`-${beforeLines[index]}`);
  for (let index = first; index <= lastAfter; index += 1) lines.push(`+${afterLines[index]}`);
  if (hasTrailingContext) {
    for (let index = lastBefore + 1; index <= trailingContextEnd; index += 1) lines.push(` ${beforeLines[index]}`);
  }
  // A literal blank context line is represented as ` ` in a unified patch,
  // which becomes trailing whitespace when the patch itself is committed.
  // Replacing it with a delete/add pair preserves exact patch application
  // while keeping repository whitespace checks clean.
  const normalizedLines = [];
  for (const line of lines) {
    if (line === " ") {
      normalizedLines.push("-", "+");
    } else {
      normalizedLines.push(line);
    }
  }
  const contextTrailingLines = hasTrailingContext ? trailingLines : 0;
  const beforeCount = leadingCount + Math.max(0, lastBefore - first + 1) + contextTrailingLines;
  const afterCount = leadingCount + Math.max(0, lastAfter - first + 1) + contextTrailingLines;
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -${contextStart + 1},${beforeCount} +${contextStart + 1},${afterCount} @@\n${normalizedLines.join("\n")}`;
}

function findLine(value, token) {
  const line = value.split("\n").find((candidate) => candidate.includes(token));
  if (!line) throw new Error(`Missing mechanism fixture token ${token}.`);
  return line;
}

function replaceLine(value, beforeLine, afterLine) {
  const lines = value.split("\n");
  const index = lines.indexOf(beforeLine);
  if (index < 0) throw new Error("Mechanism mutation line is not present in the baseline.");
  lines.splice(index, 1, ...afterLine.split("\n"));
  return lines.join("\n");
}

function writeFixture(path, content) {
  const absolute = join(fixtureRoot, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content.endsWith("\n") ? content : `${content}\n`, { mode: 0o644 });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) generateMechanismCorpus();
