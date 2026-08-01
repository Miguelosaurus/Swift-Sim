import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const fixtureRoot = join(repositoryRoot, "benchmarks", "fixtures", "sources");
const corpusRoot = join(repositoryRoot, "benchmarks", "corpora", "native-surfaces");
const mutationRoot = join(corpusRoot, "mutations");
const sourcePath = "CatalogApp/NativeSurfaceCoverageScreen.swift";

const source = `import Foundation
import SwiftUI
// extra-import-slot
// native-import-end-slot

@available(iOS 26.1, *)
struct NativeSurfaceCoverageScreen: View {
    @State private var nativePath: [String] = []
    @State private var splitVisibility: NavigationSplitViewVisibility = .automatic
    @Namespace private var nativeNamespace
    private let storedSurfaceTitle: String = "Native surfaces"
    // extra-state-slot
    // extra-namespace-slot
    // extra-member-slot
    // native-member-end-slot

    var body: some View {
        NavigationStack(path: $nativePath) {
            ScrollView {
                VStack(spacing: 8) {
                    Text(storedSurfaceTitle).font(.headline)
                    Menu { Button("Menu Action") {} } label: { BenchmarkMarkerView(value: "native-menu") }
                    BenchmarkMarkerView(value: "native-context-menu").contextMenu { Button("Context Action") {} }
                    BenchmarkMarkerView(value: "native-confirmation-dialog").confirmationDialog("Confirm Action", isPresented: .constant(false), titleVisibility: .visible) { Button("Confirm") {} }
                    BenchmarkMarkerView(value: "native-sheet").sheet(isPresented: .constant(false)) { Text("Sheet Content").presentationDetents([.medium]) }
                    BenchmarkMarkerView(value: "native-popover").popover(isPresented: .constant(false)) { Text("Popover Content") }
                    BenchmarkMarkerView(value: "native-navigation-stack").navigationTitle("Navigation")
                    NavigationLink(value: "detail") { BenchmarkMarkerView(value: "native-navigation-link") }
                    VStack { BenchmarkMarkerView(value: "native-picker"); Picker("Native Picker", selection: .constant("one")) { Text("One").tag("one"); Text("Two").tag("two") } }.pickerStyle(.segmented)
                    ControlGroup { Button {} label: { BenchmarkMarkerView(value: "native-control-group") }; Button("Second") {} }.controlGroupStyle(.menu)
                    List { Section("Native List") { BenchmarkMarkerView(value: "native-list") } }.listStyle(.insetGrouped).frame(height: 120)
                    Form { Section("Native Form") { BenchmarkMarkerView(value: "native-form") } }.formStyle(.grouped).frame(height: 120)
                    ShareLink(item: "Native Surface") { BenchmarkMarkerView(value: "native-share-link") }
                    Toggle(isOn: .constant(true)) { BenchmarkMarkerView(value: "native-toggle") }.toggleStyle(.switch)
                    Stepper(value: .constant(1), in: 0...3) { BenchmarkMarkerView(value: "native-stepper") }
                    VStack { BenchmarkMarkerView(value: "native-slider"); Slider(value: .constant(0.5), in: 0...1) }
                    DatePicker(selection: .constant(Date()), displayedComponents: .date) { BenchmarkMarkerView(value: "native-date-picker") }
                    VStack { BenchmarkMarkerView(value: "native-text-field"); TextField("Native Field", text: .constant("")) }
                    ProgressView(value: 0.5) { BenchmarkMarkerView(value: "native-progress") }
                    NavigationSplitView(columnVisibility: $splitVisibility) { BenchmarkMarkerView(value: "native-split-sidebar") } detail: { BenchmarkMarkerView(value: "native-split-detail") }.navigationSplitViewStyle(.balanced)
                    VStack { BenchmarkMarkerView(value: "native-search"); Text("Search host") }.searchable(text: .constant(""), placement: .toolbar, prompt: "Search")
                    BenchmarkMarkerView(value: "native-toolbar-role").toolbarRole(.editor)
                    BenchmarkMarkerView(value: "native-toolbar-title").navigationBarTitleDisplayMode(.inline)
                    BenchmarkMarkerView(value: "native-presentation-detent").sheet(isPresented: .constant(false)) { Text("Detent Content").presentationDetents([.medium]) }
                    BenchmarkMarkerView(value: "native-presentation-drag").sheet(isPresented: .constant(false)) { Text("Drag Content").presentationDragIndicator(.visible) }
                }
                .padding()
            }
            .navigationDestination(for: String.self) { value in BenchmarkMarkerView(value: "native-destination").overlay(Text(value)) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button {} label: { BenchmarkMarkerView(value: "native-toolbar-leading") } }
                ToolbarItemGroup(placement: .topBarTrailing) { Button {} label: { BenchmarkMarkerView(value: "native-toolbar-group") } }
            }
        }
    }
}
`;

const hotDefinitions = [
  ["native-menu", "native-menu-content", "Menu Action", "Updated Menu Action"],
  ["native-context-menu", "native-context-menu", "Context Action", "Updated Context Action"],
  ["native-confirmation-dialog", "native-confirmation-dialog", "Confirm Action", "Updated Confirm Action"],
  ["native-sheet", "native-sheet-presentation", "Sheet Content", "Updated Sheet Content"],
  ["native-popover", "native-popover-presentation", "Popover Content", "Updated Popover Content"],
  ["native-navigation-stack", "native-navigation-stack", "Navigation", "Explore"],
  ["native-navigation-link", "native-navigation-link", "detail", "updated-detail"],
  ["native-picker", "native-picker-style", ".segmented", ".menu"],
  ["native-control-group", "native-control-group-style", ".menu", ".navigation"],
  ["native-list", "native-list-style", ".insetGrouped", ".plain"],
  ["native-form", "native-form-style", ".grouped", ".automatic"],
  ["native-share-link", "native-share-link-content", "Native Surface", "Updated Surface"],
  ["native-toggle", "native-toggle-style", ".switch", ".button"],
  ["native-stepper", "native-stepper-range", "0...3", "0...5"],
  ["native-slider", "native-slider-value", "0.5", "0.75"],
  ["native-date-picker", "native-date-picker-selection", "Date()", "Date(timeIntervalSince1970: 1)"],
  ["native-text-field", "native-text-field-label", "Native Field", "Updated Field"],
  ["native-progress", "native-progress-value", "0.5", "0.75"],
  ["native-split-sidebar", "native-split-style", ".balanced", ".automatic"],
  ["native-search", "native-search-prompt", "Search", "Find"],
  ["native-toolbar-role", "native-toolbar-role", ".editor", ".browser"],
  ["native-toolbar-title", "native-toolbar-title", ".inline", ".large"],
  ["native-presentation-detent", "native-presentation-detent", ".medium", ".large"],
  ["native-presentation-drag", "native-presentation-drag", ".visible", ".hidden"],
];

const rebuildDefinitions = [
  ["native-surface-stored-property", "stored-property", "private let storedSurfaceTitle: String = \"Native surfaces\"", "private let storedSurfaceTitle: String = \"Updated surfaces\""],
  ["native-surface-add-state", "stored-property", "// extra-state-slot", "@State private var extraSurfaceState = false"],
  ["native-surface-add-namespace", "stored-property", "// extra-namespace-slot", "@Namespace private var extraSurfaceNamespace"],
  ["native-surface-add-member", "declaration-shape", "// extra-member-slot", "private var extraSurfaceTitle: String { storedSurfaceTitle }"],
  ["native-surface-add-attribute", "declaration-attribute", "struct NativeSurfaceCoverageScreen: View {", "@MainActor struct NativeSurfaceCoverageScreen: View {"],
  ["native-surface-conformance", "type-shape", "struct NativeSurfaceCoverageScreen: View {", "struct NativeSurfaceCoverageScreen: View, Sendable {"],
  ["native-surface-import", "import-change", "// extra-import-slot", "import UIKit"],
];

export function generateNativeSurfaceCorpus() {
  writeFixture(sourcePath, source);
  mkdirSync(mutationRoot, { recursive: true });
  const cases = [
    ...hotDefinitions.map(([id, category, beforeToken, afterToken]) =>
      makeCase({ id, category, expectedLane: "hot-reload", beforeToken, afterToken, oracle: `${id}-edited` })),
    ...rebuildDefinitions.map(([id, category, beforeToken, afterToken]) =>
      makeCase({ id, category, expectedLane: "build-device", beforeToken, afterToken })),
  ];
  const corpus = {
    schemaVersion: 1,
    corpusVersion: "native-surfaces-1",
    fixtureRevision: "native-surfaces-fixture-1",
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
  const beforeLine = expectedLane === "hot-reload"
    ? findLine(source, `value: "${id}"`)
    : findLine(source, beforeToken);
  if (!beforeLine.includes(beforeToken)) {
    throw new Error(`Native surface case ${id} does not contain its mutation token ${beforeToken}.`);
  }
  let afterLine = beforeLine.replace(beforeToken, afterToken);
  if (expectedLane === "hot-reload") {
    afterLine = afterLine.replace(`value: "${id}"`, `caseID: "${id}", value: "${oracle}"`);
  }
  if (beforeLine === afterLine) throw new Error(`No mutation target for ${id}.`);
  const after = replaceLine(source, beforeLine, afterLine);
  const mutationName = `${id}.patch`;
  writeFileSync(join(mutationRoot, mutationName), `${makePatch(sourcePath, source, after)}\n`, { mode: 0o644 });
  return {
    id,
    workload: "CatalogApp",
    category,
    validity: "valid",
    expectedLane,
    ...(expectedLane === "hot-reload" ? {
      confirmationPolicy: "swiftui-body",
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
  const hasLeadingContext = first > 0 && beforeLines[first - 1] !== "";
  const contextStart = hasLeadingContext ? first - 1 : first;
  const hasTrailingContext = lastBefore + 1 < beforeLines.length
    && lastAfter + 1 < afterLines.length
    && beforeLines[lastBefore + 1] === afterLines[lastAfter + 1]
    && beforeLines[lastBefore + 1] !== "";
  const lines = [];
  for (let index = contextStart; index < first; index += 1) lines.push(` ${beforeLines[index]}`);
  for (let index = first; index <= lastBefore; index += 1) lines.push(`-${beforeLines[index]}`);
  for (let index = first; index <= lastAfter; index += 1) lines.push(`+${afterLines[index]}`);
  if (hasTrailingContext) lines.push(` ${beforeLines[lastBefore + 1]}`);
  const leadingCount = hasLeadingContext ? 1 : 0;
  const trailingCount = hasTrailingContext ? 1 : 0;
  const beforeCount = leadingCount + Math.max(0, lastBefore - first + 1) + trailingCount;
  const afterCount = leadingCount + Math.max(0, lastAfter - first + 1) + trailingCount;
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -${contextStart + 1},${beforeCount} +${contextStart + 1},${afterCount} @@\n${lines.join("\n")}`;
}

function findLine(value, token) {
  const line = value.split("\n").find((candidate) => candidate.includes(token));
  if (!line) throw new Error(`Missing native surface fixture token ${token}.`);
  return line;
}

function replaceLine(value, beforeLine, afterLine) {
  const lines = value.split("\n");
  const index = lines.indexOf(beforeLine);
  if (index < 0) throw new Error("Native surface mutation line is not present in the baseline.");
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

if (import.meta.url === `file://${process.argv[1]}`) generateNativeSurfaceCorpus();
