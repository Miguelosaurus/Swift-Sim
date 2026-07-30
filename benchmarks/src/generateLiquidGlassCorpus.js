import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const fixtureRoot = join(repositoryRoot, "benchmarks", "fixtures", "sources");
const corpusRoot = join(repositoryRoot, "benchmarks", "corpora", "liquid-glass");
const mutationRoot = join(corpusRoot, "mutations");
const sourcePath = "CatalogApp/LiquidGlassCoverageScreen.swift";

const source = `import SwiftUI
@available(iOS 26.1, *)
struct LiquidGlassCoverageScreen: View {
    @Namespace private var glassNamespace
    private let storedGlass: Glass = .regular
    // extra-namespace-slot
    // extra-state-slot
    // extra-member-slot
    // extra-attribute-slot
    var body: some View {
        ScrollView {
            VStack(spacing: 4) {
                BenchmarkMarkerView(value: "glass-variant").glassEffect(.regular)
                BenchmarkMarkerView(value: "glass-material-identity").glassEffect(.identity)
                BenchmarkMarkerView(value: "glass-tint").glassEffect(.regular.tint(.blue))
                BenchmarkMarkerView(value: "glass-interactive").glassEffect(.regular.interactive(false))
                BenchmarkMarkerView(value: "glass-shape").glassEffect(.regular, in: .rect(cornerRadius: 12))
                BenchmarkMarkerView(value: "glass-default-shape").glassEffect()
                BenchmarkMarkerView(value: "glass-concentric-shape").glassEffect(.regular, in: .rect(corners: .concentric, isUniform: false))
                GlassEffectContainer(spacing: 12) { BenchmarkMarkerView(value: "glass-container").glassEffect() }
                BenchmarkMarkerView(value: "glass-identity").glassEffect().glassEffectID("primary", in: glassNamespace)
                HStack { BenchmarkMarkerView(value: "glass-union").glassEffect() }.glassEffectUnion(id: "group-a", namespace: glassNamespace)
                BenchmarkMarkerView(value: "glass-transition").glassEffect().glassEffectID("transition", in: glassNamespace).glassEffectTransition(.materialize)
                Button {} label: { BenchmarkMarkerView(value: "glass-button-style") }.buttonStyle(.glass)
                Button {} label: { BenchmarkMarkerView(value: "glass-configured-button") }.buttonStyle(.glass(.regular.tint(.blue)))
                BenchmarkMarkerView(value: "toolbar-spacer").toolbar { ToolbarSpacer(.fixed); ToolbarItem { Image(systemName: "star") } }
                BenchmarkMarkerView(value: "toolbar-shared-background").toolbar { ToolbarItem { Image(systemName: "circle") }.sharedBackgroundVisibility(.visible) }
                BenchmarkMarkerView(value: "toolbar-background").toolbarBackgroundVisibility(.visible, for: .navigationBar)
                BenchmarkMarkerView(value: "scroll-edge-style").scrollEdgeEffectStyle(.soft, for: .top)
                BenchmarkMarkerView(value: "scroll-edge-hidden").scrollEdgeEffectHidden(false, for: .top)
                BenchmarkMarkerView(value: "background-extension").backgroundExtensionEffect(isEnabled: false)
                BenchmarkMarkerView(value: "safe-area-bar").safeAreaBar(edge: .bottom, alignment: .center, spacing: 8) { Text("Status") }
                BenchmarkMarkerView(value: "tab-minimize").tabBarMinimizeBehavior(.never)
                TabView { BenchmarkMarkerView(value: "tab-accessory") }.tabViewBottomAccessory(isEnabled: false) { Text("Accessory") }
                BottomAccessoryPlacementProbe()
                TabView { Tab("Search", systemImage: "magnifyingglass", role: nil) { BenchmarkMarkerView(value: "search-tab-role") } }
                BenchmarkMarkerView(value: "search-presentation").searchable(text: .constant(""), isPresented: .constant(false), prompt: "Find")
                BenchmarkMarkerView(value: "toolbar-title").toolbarTitleDisplayMode(.inline)
                BenchmarkMarkerView(value: "control-size").controlSize(.regular)
            }
        }
    }

    private struct BottomAccessoryPlacementProbe: View {
        @Environment(\\.tabViewBottomAccessoryPlacement) private var placement
        var body: some View { BenchmarkMarkerView(value: "tab-accessory-placement").opacity(placement == .inline ? 0.9 : 1.0) }
    }
}
`;

const hotDefinitions = [
  ["glass-variant", "custom-glass-variant", ".glassEffect(.regular)", ".glassEffect(.clear)"],
  ["glass-material-identity", "custom-glass-identity", ".glassEffect(.identity)", ".glassEffect(.regular)"],
  ["glass-tint", "custom-glass-tint", ".tint(.blue)", ".tint(.orange)"],
  ["glass-interactive", "custom-glass-interactivity", ".interactive(false)", ".interactive(true)"],
  ["glass-shape", "custom-glass-shape", ".rect(cornerRadius: 12)", ".rect(cornerRadius: 28)"],
  ["glass-default-shape", "custom-glass-default-shape", ".glassEffect()", ".glassEffect(.regular, in: .circle)"],
  ["glass-concentric-shape", "concentric-control-shape", "isUniform: false", "isUniform: true"],
  ["glass-container", "glass-container-spacing", "spacing: 12", "spacing: 28"],
  ["glass-identity", "glass-effect-identity", "\"primary\"", "\"secondary\""],
  ["glass-union", "glass-effect-union", "\"group-a\"", "\"group-b\""],
  ["glass-transition", "glass-effect-transition", ".materialize", ".matchedGeometry"],
  ["glass-button-style", "glass-button-style", ".buttonStyle(.glass)", ".buttonStyle(.glassProminent)"],
  ["glass-configured-button", "configured-glass-button-style", ".tint(.blue)", ".tint(.orange)"],
  ["toolbar-spacer", "system-toolbar-grouping", "ToolbarSpacer(.fixed)", "ToolbarSpacer(.flexible)"],
  ["toolbar-shared-background", "system-toolbar-glass-background", ".sharedBackgroundVisibility(.visible)", ".sharedBackgroundVisibility(.hidden)"],
  ["toolbar-background", "system-toolbar-background-visibility", ".toolbarBackgroundVisibility(.visible", ".toolbarBackgroundVisibility(.hidden"],
  ["scroll-edge-style", "scroll-edge-legibility", ".scrollEdgeEffectStyle(.soft", ".scrollEdgeEffectStyle(.hard"],
  ["scroll-edge-hidden", "scroll-edge-visibility", ".scrollEdgeEffectHidden(false", ".scrollEdgeEffectHidden(true"],
  ["background-extension", "edge-to-edge-background", "isEnabled: false", "isEnabled: true"],
  ["safe-area-bar", "custom-scroll-edge-bar", "spacing: 8", "spacing: 20"],
  ["tab-minimize", "liquid-glass-tab-behavior", ".tabBarMinimizeBehavior(.never)", ".tabBarMinimizeBehavior(.onScrollDown)"],
  ["tab-accessory", "liquid-glass-tab-accessory", "isEnabled: false", "isEnabled: true"],
  ["tab-accessory-placement", "liquid-glass-tab-accessory-placement", "0.9", "0.8"],
  ["search-tab-role", "liquid-glass-search-tab", "role: nil", "role: .search"],
  ["search-presentation", "liquid-glass-search-presentation", "prompt: \"Find\"", "prompt: \"Explore\""],
  ["toolbar-title", "liquid-glass-toolbar-title", ".toolbarTitleDisplayMode(.inline)", ".toolbarTitleDisplayMode(.inlineLarge)"],
  ["control-size", "liquid-glass-control-sizing", ".controlSize(.regular)", ".controlSize(.extraLarge)"],
];

const rebuildDefinitions = [
  ["liquid-glass-stored-initializer", "stored-property", "private let storedGlass: Glass = .regular", "private let storedGlass: Glass = .clear"],
  ["liquid-glass-add-namespace", "stored-property", "// extra-namespace-slot", "@Namespace private var extraNamespace"],
  ["liquid-glass-add-state", "stored-property", "// extra-state-slot", "@State private var expanded = false"],
  ["liquid-glass-add-member", "declaration-shape", "// extra-member-slot", "private var extraGlass: Glass { .regular }"],
  ["liquid-glass-add-attribute", "declaration-attribute", "// extra-attribute-slot", "@MainActor"],
  ["liquid-glass-conformance", "type-shape", "struct LiquidGlassCoverageScreen: View {", "struct LiquidGlassCoverageScreen: View, Sendable {"],
  ["liquid-glass-import", "import-change", "import SwiftUI", "import SwiftUI\nimport UIKit"],
];

export function generateLiquidGlassCorpus() {
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
    corpusVersion: "liquid-glass-1",
    fixtureRevision: "liquid-glass-fixture-1",
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
    throw new Error(`Liquid Glass case ${id} does not contain its mutation token ${beforeToken}.`);
  }
  let afterLine = beforeLine.replace(beforeToken, afterToken);
  if (expectedLane === "hot-reload") {
    afterLine = afterLine
      .replace(`value: "${id}"`, `caseID: "${id}", value: "${oracle}"`);
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
    && beforeLines[lastBefore + 1] !== ""
    && beforeLines[lastBefore + 1] === afterLines[lastAfter + 1];
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
  if (!line) throw new Error(`Missing Liquid Glass fixture token ${token}.`);
  return line;
}

function replaceLine(value, beforeLine, afterLine) {
  const lines = value.split("\n");
  const index = lines.indexOf(beforeLine);
  if (index < 0) throw new Error("Liquid Glass mutation line is not present in the baseline.");
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

if (import.meta.url === `file://${process.argv[1]}`) generateLiquidGlassCorpus();
