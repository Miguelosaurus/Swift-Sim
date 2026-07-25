import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const fixtureRoot = join(repositoryRoot, "benchmarks", "fixtures", "sources");
const corpusRoot = join(repositoryRoot, "benchmarks", "corpora", "core");
const mutationRoot = join(corpusRoot, "mutations");

const workloads = {
  CatalogApp: {
    file: "CatalogApp/CatalogScreen.swift",
    source: catalogSource(),
  },
  StateApp: {
    file: "StateApp/StateScreen.swift",
    source: stateSource(),
  },
  ArchitectureApp: {
    file: "ArchitectureApp/ArchitectureScreen.swift",
    source: architectureSource(),
  },
};

export function generateCoreCorpus() {
  for (const workload of Object.values(workloads)) writeFixture(workload.file, workload.source);
  writeFixture("CatalogApp/Resources/Labels.txt", "catalog.label=Catalog\nedit.label=Edit\n");
  writeFixture("CatalogApp/Resources/BenchmarkInfo.txt", "Swift Sim hot-reload benchmark fixture\n");
  writeFixture("Package.swift", "// benchmark package baseline\nlet packageName = \"Benchmark\"\n");
  writeFixture("BuildSettings.xcconfig", "SWIFT_VERSION = 6.0\nSWIFT_OPTIMIZATION_LEVEL = -Onone\n");
  mkdirSync(corpusRoot, { recursive: true });
  mkdirSync(mutationRoot, { recursive: true });

  const cases = [
    ...hotCases(),
    ...rebuildCases(),
    ...errorCases(),
  ];
  const corpus = {
    schemaVersion: 1,
    corpusVersion: "core-1",
    fixtureRevision: "core-fixture-1",
    metadata: {
      totalCases: cases.length,
      expectedHotReload: cases.filter((value) => value.validity === "valid" && value.expectedLane === "hot-reload").length,
      expectedRebuild: cases.filter((value) => value.validity === "valid" && value.expectedLane === "build-device").length,
      authoringErrors: cases.filter((value) => value.validity === "authoring-error").length,
      multiFileOperations: cases.filter((value) => value.multiFile === true).length,
      smokeHotCases: cases.filter((value) => value.smoke === true && value.expectedLane === "hot-reload").length,
    },
    cases,
  };
  writeFileSync(join(corpusRoot, "corpus.json"), `${JSON.stringify(corpus, null, 2)}\n`, { mode: 0o644 });
  return corpus;
}

function hotCases() {
  const cases = [];
  const definitions = [
    ["copy-literal", "CatalogApp", "copy", "copy-edited-"],
    ["style-modifier", "CatalogApp", "style", "style-edited-"],
    ["layout-modifier", "CatalogApp", "layout", "layout-edited-"],
    ["swiftui-composition", "CatalogApp", "composition", "composition-edited-"],
    ["animation-transition", "CatalogApp", "animation", "animation-edited-"],
    ["closure-action", "StateApp", "action", "action-edited-"],
    ["computed-view", "StateApp", "computed", "computed-edited-"],
    ["helper-function", "StateApp", "helper", "helper-edited-"],
    ["async-task", "StateApp", "async", "async-edited-"],
    ["nested-extension-view", "ArchitectureApp", "nested", "nested-edited-"],
    ["generic-actor-body", "ArchitectureApp", "generic", "generic-edited-"],
  ];

  for (const [category, workloadName, slot, afterToken] of definitions) {
    for (let index = 1; index <= 10; index += 1) {
      const number = String(index).padStart(2, "0");
      const workload = workloads[workloadName];
      const before = workload.source;
      const token = `${slot}-${number}`;
      const beforeLine = findLine(before, token);
      const afterLine = annotateCaseMarker(
        hotLineAfter({ category, beforeLine, number, slot, afterToken }),
        `${slug(category)}-${number}`,
      );
      if (beforeLine === afterLine) throw new Error(`No hot mutation target for ${category} ${number}.`);
      cases.push(makeCase({
        id: `${slug(category)}-${number}`,
        workload: workloadName,
        category,
        expectedLane: "hot-reload",
        confirmationPolicy: category.includes("function") || category.includes("actor") || category === "async-task"
          ? "interposed-function"
          : "swiftui-body",
        files: [{ path: workload.file, before, beforeLine, afterLine }],
        oracle: { case: `${slug(category)}-${number}`, value: `${afterToken}${number}` },
        smoke: index <= 2,
      }));
    }
  }

  for (let index = 1; index <= 10; index += 1) {
    const number = String(index).padStart(2, "0");
    const first = workloads.ArchitectureApp;
    const second = workloads.StateApp;
    cases.push(makeCase({
      id: `multi-file-implementation-${number}`,
      workload: "ArchitectureApp",
      category: "multi-file-implementation",
      expectedLane: "hot-reload",
      confirmationPolicy: "swiftui-body",
      files: [
        { path: first.file, before: first.source, beforeLine: findLine(first.source, `nested-${number}`), afterLine: annotateCaseMarker(findLine(first.source, `nested-${number}`).replace(`nested-${number}`, `nested-edited-${number}`), `multi-file-implementation-${number}`) },
        { path: second.file, before: second.source, beforeLine: findLine(second.source, `helper-${number}`), afterLine: findLine(second.source, `helper-${number}`).replace(`helper-${number}`, `helper-edited-${number}`) },
      ],
      oracle: { case: `multi-file-implementation-${number}`, value: `nested-edited-${number}` },
      smoke: index <= 2,
    }));
  }
  return cases;
}

function rebuildCases() {
  const cases = [];
  const catalog = workloads.CatalogApp;
  const state = workloads.StateApp;
  const architecture = workloads.ArchitectureApp;

  for (let index = 1; index <= 20; index += 1) {
    const number = String(index).padStart(2, "0");
    const beforeLine = findLine(catalog.source, `storedSlot${number}`);
    const files = [{ path: catalog.file, before: catalog.source, beforeLine, afterLine: beforeLine.replace(`stored-${number}`, `stored-edited-${number}`) }];
    if (index <= 14) {
      const stateLine = findLine(state.source, "signatureSlot01");
      files.push({ path: state.file, before: state.source, beforeLine: stateLine, afterLine: stateLine.replace("(_ value: Int)", "(_ value: Int, extra: Bool)") });
    }
    cases.push(makeCase({
      id: `stored-property-${number}`,
      workload: "CatalogApp",
      category: "stored-property",
      expectedLane: "build-device",
      files,
    }));
  }
  for (let index = 1; index <= 15; index += 1) {
    const number = String(index).padStart(2, "0");
    const beforeLine = findLine(state.source, `signatureSlot${number}`);
    cases.push(makeCase({
      id: `signature-change-${number}`,
      workload: "StateApp",
      category: "signature-change",
      expectedLane: "build-device",
      files: [{ path: state.file, before: state.source, beforeLine, afterLine: beforeLine.replace("(_ value: Int)", "(_ value: Int, extra: Bool)") }],
    }));
  }
  for (let index = 1; index <= 15; index += 1) {
    const number = String(index).padStart(2, "0");
    const beforeLine = findLine(architecture.source, `struct ShapeSlot${number}`);
    cases.push(makeCase({
      id: `type-shape-${number}`,
      workload: "ArchitectureApp",
      category: "type-shape",
      expectedLane: "build-device",
      files: [{ path: architecture.file, before: architecture.source, beforeLine, afterLine: beforeLine.replace("{}", "{ var changed: Bool = true }") }],
    }));
  }
  for (let index = 1; index <= 10; index += 1) {
    const number = String(index).padStart(2, "0");
    const beforeLine = findLine(architecture.source, `enum ChoiceSlot${number}`);
    cases.push(makeCase({
      id: `enum-protocol-${number}`,
      workload: "ArchitectureApp",
      category: "enum-protocol-shape",
      expectedLane: "build-device",
      files: [{ path: architecture.file, before: architecture.source, beforeLine, afterLine: `${beforeLine} { case changed }` }],
    }));
  }
  for (let index = 1; index <= 10; index += 1) {
    const number = String(index).padStart(2, "0");
    const beforeLine = findLine(state.source, `accessSlot${number}`);
    cases.push(makeCase({
      id: `access-attribute-${number}`,
      workload: "StateApp",
      category: "access-attribute",
      expectedLane: "build-device",
      files: [{ path: state.file, before: state.source, beforeLine, afterLine: beforeLine.replace("private func", "internal func") }],
    }));
  }
  for (let index = 1; index <= 5; index += 1) {
    const number = String(index).padStart(2, "0");
    const beforeLine = findLine(catalog.source, `importSlot${number}`);
    cases.push(makeCase({
      id: `import-change-${number}`,
      workload: "CatalogApp",
      category: "import-change",
      expectedLane: "build-device",
      files: [{ path: catalog.file, before: catalog.source, beforeLine, afterLine: `${beforeLine}\nimport Foundation` }],
    }));
  }
  for (let index = 1; index <= 5; index += 1) {
    const number = String(index).padStart(2, "0");
    const beforeLine = findLine(catalog.source, `macroSlot${number}`);
    cases.push(makeCase({
      id: `macro-change-${number}`,
      workload: "CatalogApp",
      category: "macro-change",
      expectedLane: "build-device",
      files: [{ path: catalog.file, before: catalog.source, beforeLine, afterLine: `#attached(member, names: named(changed))\n${beforeLine}` }],
    }));
  }
  for (let index = 1; index <= 5; index += 1) {
    const number = String(index).padStart(2, "0");
    const file = `CatalogApp/NewFile${number}.swift`;
    cases.push(makeCase({
      id: `file-added-${number}`,
      workload: "CatalogApp",
      category: "file-lifecycle",
      expectedLane: "build-device",
      files: [{ path: file, status: "added", before: "", after: `import SwiftUI\nstruct NewFile${number}: View { var body: some View { Text(\"new\") } }\n` }],
    }));
  }
  for (let index = 1; index <= 5; index += 1) {
    const number = String(index).padStart(2, "0");
    const file = `CatalogApp/OldFile${number}.swift`;
    const before = `import SwiftUI\nstruct OldFile${number}: View { var body: some View { Text(\"old\") } }\n`;
    writeFixture(file, before);
    cases.push(makeCase({
      id: `file-deleted-${number}`,
      workload: "CatalogApp",
      category: "file-lifecycle",
      expectedLane: "build-device",
      files: [{ path: file, status: "deleted", before, after: "" }],
    }));
  }
  for (let index = 1; index <= 5; index += 1) {
    const number = String(index).padStart(2, "0");
    const file = "CatalogApp/Resources/Labels.txt";
    const before = readFileSync(join(fixtureRoot, file), "utf8");
    const beforeLine = findLine(before, "catalog.label");
    cases.push(makeCase({
      id: `resource-change-${number}`,
      workload: "CatalogApp",
      category: "resource-change",
      expectedLane: "build-device",
      files: [{ path: file, before, beforeLine, afterLine: beforeLine.replace("Catalog", `Catalog ${number}`) }],
    }));
  }
  for (let index = 1; index <= 4; index += 1) {
    const number = String(index).padStart(2, "0");
    const file = "BuildSettings.xcconfig";
    const before = readFileSync(join(fixtureRoot, file), "utf8");
    const beforeLine = findLine(before, "SWIFT_VERSION");
    cases.push(makeCase({
      id: `build-settings-${number}`,
      workload: "CatalogApp",
      category: "package-build-setting",
      expectedLane: "build-device",
      files: [{ path: file, before, beforeLine, afterLine: beforeLine.replace("6.0", "6.1") }],
    }));
  }

  const mixedCatalog = workloads.CatalogApp;
  const hotLine = findLine(mixedCatalog.source, "style-01");
  const storedLine = findLine(mixedCatalog.source, "stored-01");
  cases.push(makeCase({
    id: "mixed-hot-and-structural-01",
    workload: "CatalogApp",
    category: "mixed-edit-set",
    expectedLane: "build-device",
    files: [
      { path: mixedCatalog.file, before: mixedCatalog.source, beforeLine: hotLine, afterLine: hotLine.replace(".blue", ".purple") },
      { path: mixedCatalog.file, before: mixedCatalog.source, beforeLine: storedLine, afterLine: storedLine.replace("stored-01", "stored-edited-01") },
    ],
  }));
  return cases;
}

function errorCases() {
  const cases = [];
  const state = workloads.StateApp;
  for (let index = 1; index <= 20; index += 1) {
    const number = String(index).padStart(2, "0");
    const beforeLine = findLine(state.source, `errorSlot${number}`);
    cases.push(makeCase({
      id: `authoring-error-${number}`,
      workload: "StateApp",
      category: "syntax-or-type-error",
      validity: "authoring-error",
      expectedLane: "hot-reload",
      confirmationPolicy: "unverified",
      files: [{ path: state.file, before: state.source, beforeLine, afterLine: `${beforeLine} {` }],
    }));
  }
  return cases;
}

function hotLineAfter({ category, beforeLine, number, slot, afterToken }) {
  if (category === "style-modifier") return beforeLine.replace(`style-${number}`, `style-edited-${number}`).replace(".blue", ".purple");
  if (category === "layout-modifier") return beforeLine.replace(`layout-${number}`, `layout-edited-${number}`).replace(".padding(8)", ".padding(24)");
  if (category === "swiftui-composition") return beforeLine.replace(`composition-${number}`, `composition-edited-${number}`).replace("if true", "if false");
  if (category === "animation-transition") return beforeLine.replace(`animation-${number}`, `animation-edited-${number}`).replace("0.2", "0.45");
  if (category === "copy-literal") return beforeLine.replace(`copy-${number}`, `copy-edited-${number}`);
  return beforeLine.replace(`${slot}-${number}`, `${afterToken}${number}`);
}

function annotateCaseMarker(line, caseID) {
  return line.replace(
    /BenchmarkMarkerView\(value:\s*"([^"]+)"\)/,
    `BenchmarkMarkerView(caseID: "${caseID}", value: "$1")`,
  );
}

function makeCase({
  id,
  workload,
  category,
  expectedLane,
  files,
  confirmationPolicy,
  oracle,
  smoke = false,
  validity = "valid",
}) {
  const mutationName = `${id}.patch`;
  const patches = [];
  const baselineHashes = {};
  for (const file of files) {
    const normalizedPath = file.path.replaceAll("\\", "/");
    const baselinePath = join(fixtureRoot, normalizedPath);
    if (file.status !== "added") {
      if (!readFileSafe(baselinePath) && file.before) writeFixture(normalizedPath, file.before);
      baselineHashes[normalizedPath] = sha256(file.before || readFileSync(baselinePath, "utf8"));
    }
    patches.push(makePatch({
      path: normalizedPath,
      status: file.status || "modified",
      before: file.before || "",
      after: file.after || replaceLine(file.before, file.beforeLine, file.afterLine),
    }));
  }
  writeFileSync(join(mutationRoot, mutationName), `${patches.join("\n")}\n`, { mode: 0o644 });
  return {
    id,
    workload,
    category,
    validity,
    expectedLane,
    ...(confirmationPolicy ? { confirmationPolicy } : {}),
    mutation: `mutations/${mutationName}`,
    baselineHashes,
    ...(oracle ? { oracle } : {}),
    ...(files.length > 1 ? { multiFile: true } : {}),
    ...(smoke ? { smoke: true } : {}),
  };
}

function makePatch({ path, status, before, after }) {
  const oldPath = status === "added" ? "/dev/null" : `a/${path}`;
  const newPath = status === "deleted" ? "/dev/null" : `b/${path}`;
  if (status === "added") {
    return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n${fullHunk([], after.split("\n").filter(Boolean), 0, 1)}`;
  }
  if (status === "deleted") {
    return `diff --git a/${path} b/${path}\ndeleted file mode 100644\n--- a/${path}\n+++ /dev/null\n${fullHunk(before.split("\n").filter(Boolean), [], 1, 0)}`;
  }
  const beforeLines = before.replace(/\n$/, "").split("\n");
  const afterLines = after.replace(/\n$/, "").split("\n");
  return `diff --git a/${path} b/${path}\n--- ${oldPath}\n+++ ${newPath}\n${diffHunk(beforeLines, afterLines)}`;
}

function diffHunk(beforeLines, afterLines) {
  let first = 0;
  while (first < beforeLines.length && first < afterLines.length && beforeLines[first] === afterLines[first]) first += 1;
  let lastBefore = beforeLines.length - 1;
  let lastAfter = afterLines.length - 1;
  while (lastBefore >= first && lastAfter >= first && beforeLines[lastBefore] === afterLines[lastAfter]) {
    lastBefore -= 1;
    lastAfter -= 1;
  }
  const contextStart = Math.max(0, first - 1);
  const contextBeforeEnd = Math.min(beforeLines.length, lastBefore + 2);
  const contextAfterEnd = Math.min(afterLines.length, lastAfter + 2);
  const lines = [];
  for (let index = contextStart; index < first; index += 1) lines.push(` ${beforeLines[index]}`);
  for (let index = first; index <= lastBefore; index += 1) lines.push(`-${beforeLines[index]}`);
  for (let index = first; index <= lastAfter; index += 1) lines.push(`+${afterLines[index]}`);
  for (let index = lastBefore + 1; index < contextBeforeEnd; index += 1) lines.push(` ${beforeLines[index]}`);
  if (lastAfter + 1 < contextAfterEnd && lastBefore + 1 >= contextBeforeEnd) {
    for (let index = lastAfter + 1; index < contextAfterEnd; index += 1) lines.push(` ${afterLines[index]}`);
  }
  const beforeCount = contextBeforeEnd - contextStart;
  const afterCount = contextAfterEnd - contextStart;
  return `@@ -${contextStart + 1},${beforeCount} +${contextStart + 1},${afterCount} @@\n${lines.join("\n")}`;
}

function fullHunk(beforeLines, afterLines, beforeStart, afterStart) {
  const lines = [
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ];
  return `@@ -${beforeStart},${beforeLines.length} +${afterStart},${afterLines.length} @@\n${lines.join("\n")}`;
}

function findLine(source, token, includeLineWithoutToken = false) {
  const line = source.split("\n").find((candidate) => candidate.includes(token));
  if (!line && !includeLineWithoutToken) throw new Error(`Missing fixture token ${token}.`);
  return line || "";
}

function replaceLine(source, beforeLine, afterLine) {
  if (beforeLine === undefined) return source;
  const lines = source.split("\n");
  const index = lines.indexOf(beforeLine);
  if (index < 0) throw new Error("Fixture mutation line is not present in its baseline.");
  lines[index] = afterLine;
  return lines.join("\n");
}

function writeFixture(path, content) {
  const absolute = join(fixtureRoot, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content.endsWith("\n") ? content : `${content}\n`, { mode: 0o644 });
}

function readFileSafe(path) {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function slug(value) {
  return value.toLowerCase().replaceAll(" ", "-");
}

function catalogSource() {
  const lines = [
    "import SwiftUI",
    ...Array.from({ length: 10 }, (_, index) => `// importSlot${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 10 }, (_, index) => `// macroSlot${String(index + 1).padStart(2, "0")}`),
    "struct CatalogScreen: View {",
    "    let title: String = \"Catalog\"",
    ...Array.from({ length: 20 }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      return `    let storedSlot${number}: String = \"stored-${number}\"`;
    }),
    "    var body: some View {",
    "        VStack {",
  ];
  for (const category of ["copy", "style", "layout", "composition", "animation", "macro", "import"]) {
    for (let index = 1; index <= 10; index += 1) {
      const number = String(index).padStart(2, "0");
      if (category === "copy") lines.push(`            BenchmarkMarkerView(value: \"copy-${number}\")`);
      if (category === "style") lines.push(`            BenchmarkMarkerView(value: \"style-${number}\").foregroundStyle(.blue)`);
      if (category === "layout") lines.push(`            BenchmarkMarkerView(value: \"layout-${number}\").padding(8)`);
      if (category === "composition") lines.push(`            if true { BenchmarkMarkerView(value: \"composition-${number}\") }`);
      if (category === "animation") lines.push(`            BenchmarkMarkerView(value: \"animation-${number}\").animation(.easeInOut(duration: 0.2), value: title)`);
      if (category === "macro") lines.push(`            Text(\"macro-${number}\")`);
      if (category === "import") lines.push(`            Text(\"import-${number}\")`);
    }
  }
  lines.push("        }");
  lines.push("    }");
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function stateSource() {
  const actionMarkers = Array.from({ length: 15 }, (_, index) => `BenchmarkMarkerView(value: actionSlot${String(index + 1).padStart(2, "0")}())`).join("; ");
  const computedMarkers = Array.from({ length: 15 }, (_, index) => `computedSlot${String(index + 1).padStart(2, "0")}`).join("; ");
  const helperMarkers = Array.from({ length: 15 }, (_, index) => `BenchmarkMarkerView(value: helperSlot${String(index + 1).padStart(2, "0")}())`).join("; ");
  const asyncMarkers = Array.from({ length: 15 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return `let async${number} = await asyncSlot${number}(); BenchmarkMarker.emit(caseID: "baseline", value: async${number})`;
  }).join("; ");
  const lines = [
    "import SwiftUI",
    "struct StateScreen: View {",
    "    @State private var count = 0",
    `    var body: some View { VStack { Text("State"); ${actionMarkers}; ${computedMarkers}; ${helperMarkers} }.task { ${asyncMarkers} } }`,
  ];
  for (const category of ["action", "computed", "helper", "async", "signature", "access", "error"]) {
    const count = category === "error" ? 20 : 15;
    for (let index = 1; index <= count; index += 1) {
      const number = String(index).padStart(2, "0");
      if (category === "action") lines.push(`    private func actionSlot${number}() -> String { \"action-${number}\" }`);
      if (category === "computed") lines.push(`    private var computedSlot${number}: some View { Text(\"computed-${number}\") }`);
      if (category === "helper") lines.push(`    private func helperSlot${number}() -> String { \"helper-${number}\" }`);
      if (category === "async") lines.push(`    private func asyncSlot${number}() async -> String { \"async-${number}\" }`);
      if (category === "signature") lines.push(`    private func signatureSlot${number}(_ value: Int) -> String { \"signature-${number}\" }`);
      if (category === "access") lines.push(`    private func accessSlot${number}() -> String { \"access-${number}\" }`);
      if (category === "error") lines.push(`    private func errorSlot${number}() -> String { \"error-${number}\" }`);
    }
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function architectureSource() {
  const nestedMarkers = Array.from({ length: 15 }, (_, index) => `NestedSlot${String(index + 1).padStart(2, "0")}()`).join("; ");
  const genericMarkers = Array.from({ length: 15 }, (_, index) => `BenchmarkMarkerView(value: genericSlot${String(index + 1).padStart(2, "0")}(1))`).join("; ");
  const lines = [
    "import SwiftUI",
    "struct ArchitectureScreen: View {",
    `    var body: some View { VStack { ${nestedMarkers}; ${genericMarkers} } }`,
    "    private struct NestedCard: View {",
    "        var body: some View { BenchmarkMarkerView(value: \"nested-01\") }",
    "    }",
  ];
  for (let index = 1; index <= 15; index += 1) {
    const number = String(index).padStart(2, "0");
    lines.push(`    private struct NestedSlot${number}: View { var body: some View { BenchmarkMarkerView(value: \"nested-${number}\") } }`);
    lines.push(`    private struct ShapeSlot${number} {}`);
    lines.push(`    private enum ChoiceSlot${number} { case first }`);
    lines.push(`    private func genericSlot${number}<T>(_ value: T) -> String { \"generic-${number}\" }`);
  }
  lines.push("    actor Worker { func value() -> String { \"actor-01\" } }");
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) generateCoreCorpus();
