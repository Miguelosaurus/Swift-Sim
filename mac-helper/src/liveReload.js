import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const INJECTION_APP_CANDIDATES = [
  "/Applications/InjectionNext.app",
  `${process.env.HOME || ""}/Applications/InjectionNext.app`,
].filter(Boolean);

export function classifyLiveChange({ beforePath, afterPath }) {
  const before = requiredSwiftSource(beforePath, "before");
  const after = requiredSwiftSource(afterPath, "after");
  return classifySwiftSource(before, after, { beforePath, afterPath });
}

export function classifySwiftSource(before, after, paths = {}) {
  if (before === after) {
    return result("no-change", true, "The Swift source is unchanged.", paths);
  }

  const beforeSurface = declarationSurface(before);
  const afterSurface = declarationSurface(after);
  if (beforeSurface.unsupported || afterSurface.unsupported) {
    return result(
      "rebuild-required",
      false,
      beforeSurface.unsupported || afterSurface.unsupported,
      paths
    );
  }

  if (beforeSurface.imports !== afterSurface.imports) {
    return result("rebuild-required", false, "Imports changed.", paths);
  }
  if (beforeSurface.declarations !== afterSurface.declarations) {
    return result(
      "rebuild-required",
      false,
      "A declaration, stored property, type shape, or function signature changed.",
      paths
    );
  }

  return result(
    "hot-reload",
    true,
    "Only implementation bodies or literal values changed.",
    paths
  );
}

export function inspectLiveReload({ project = "", host = "" } = {}) {
  const projectPath = project ? resolve(project) : "";
  const projectSource = projectPath && existsSync(projectPath)
    ? readFileSync(projectPath, "utf8")
    : "";
  const injectionApp = INJECTION_APP_CANDIDATES.find(existsSync) || "";
  const tailscaleHost = host || tailscaleIPv4();
  const packageConfigured = /github\.com\/johnno1962\/InjectionNext|SwiftSimLive/i.test(projectSource);
  const interposableConfigured = /-interposable/.test(projectSource);

  return {
    ready: Boolean(injectionApp && tailscaleHost && packageConfigured && interposableConfigured),
    mode: "debug-only",
    transport: tailscaleHost ? "private-tailscale" : "unavailable",
    host: tailscaleHost,
    port: 8887,
    injectionApp: {
      ready: Boolean(injectionApp),
      path: injectionApp,
      installURL: "https://github.com/johnno1962/InjectionNext/releases",
    },
    project: {
      path: projectPath,
      readable: Boolean(projectSource),
      packageConfigured,
      interposableConfigured,
    },
    requiredBuildSettings: {
      configuration: "Debug",
      INJECTION_HOST: tailscaleHost || "<mac-tailscale-ip>",
      EMIT_FRONTEND_COMMAND_LINES: "YES",
      COMPILATION_CACHE_ENABLE_CACHING: "NO",
      OTHER_LDFLAGS: ["$(inherited)", "-Xlinker", "-interposable"],
    },
    limitations: [
      "Implementation-body and SwiftUI composition edits only",
      "The iPhone and Mac must both be connected to the same private tailnet",
      "A structural change requires a new signed build and install link",
      "Never enable this lane in App Store or Release builds",
    ],
  };
}

export function startLiveReload({ project = "", host = "" } = {}) {
  const status = inspectLiveReload({ project, host });
  if (!status.injectionApp.ready) {
    return {
      ...status,
      started: false,
      error: "InjectionNext.app is not installed.",
    };
  }
  if (!status.project.readable) {
    return {
      ...status,
      started: false,
      error: "Pass the path to an .xcodeproj/project.pbxproj file.",
    };
  }

  const projectContainer = status.project.path.replace(/\/project\.pbxproj$/, "");
  const launch = spawnSync(
    "/usr/bin/open",
    ["-a", status.injectionApp.path, "--args", "-projectPath", projectContainer],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...(status.host ? { INJECTION_HOST: status.host } : {}),
      },
    }
  );
  return {
    ...status,
    started: launch.status === 0,
    error: launch.status === 0
      ? ""
      : String(launch.stderr || launch.stdout || "Unable to launch InjectionNext.").trim(),
  };
}

export function routeLiveChange({ beforePath, afterPath, project = "", host = "" }) {
  const change = classifyLiveChange({ beforePath, afterPath });
  const live = inspectLiveReload({ project, host });

  if (change.route === "no-change") {
    return { action: "none", change, live };
  }
  if (change.hotReloadable && live.ready) {
    return {
      action: "hot-reload",
      change,
      live,
      message: "Save the file. InjectionNext will compile and deliver the patch to the running debug app.",
    };
  }
  return {
    action: "build-device",
    change,
    live,
    message: change.hotReloadable
      ? "The edit is hot-reloadable, but the live lane is not ready. Create a new Swift Sim update link."
      : "The edit changes compiled structure. Create a new Swift Sim update link.",
  };
}

function requiredSwiftSource(path, label) {
  if (!path) throw new Error(`Missing --${label}.`);
  if (extname(path).toLowerCase() !== ".swift") {
    throw new Error(`--${label} must point to a .swift file.`);
  }
  return readFileSync(resolve(path), "utf8");
}

function declarationSurface(source) {
  const clean = maskCommentsAndStrings(source);
  if (/#(?:externalMacro|freestanding|attached)\b|@_dynamicReplacement\b/.test(clean)) {
    return { unsupported: "Macros and explicit dynamic replacement require a rebuild." };
  }

  const imports = [...clean.matchAll(/^\s*(?:@testable\s+)?import\s+[^\n;]+/gm)]
    .map((match) => compact(match[0]))
    .sort()
    .join("\n");
  const declarations = [];
  const declarationPattern = /\b(actor|associatedtype|case|class|deinit|enum|extension|func|init|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\b/gm;

  for (const match of clean.matchAll(declarationPattern)) {
    if (match[1] === "class" && /^\s+(?:func|var|subscript)\b/.test(clean.slice(match.index + match[0].length))) {
      continue;
    }
    const start = match.index;
    const signature = readDeclarationSignature(clean, start, match[1]);
    declarations.push(compact(signature));
  }
  return { imports, declarations: declarations.join("\n"), unsupported: "" };
}

function readDeclarationSignature(source, start, kind) {
  let parens = 0;
  let brackets = 0;
  let angles = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") parens += 1;
    else if (char === ")") parens = Math.max(0, parens - 1);
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets = Math.max(0, brackets - 1);
    else if (char === "<") angles += 1;
    else if (char === ">") angles = Math.max(0, angles - 1);
    if (parens || brackets || angles) continue;

    if (char === "{") return source.slice(start, index);
    if (char === ";") return source.slice(start, index);
    if (char === "\n" && ["case", "import", "operator", "typealias", "associatedtype"].includes(kind)) {
      return source.slice(start, index);
    }
    if (char === "=" && ["let", "var"].includes(kind)) {
      return source.slice(start, index);
    }
    if (char === "\n" && ["let", "var"].includes(kind)) {
      return source.slice(start, index);
    }
  }
  return source.slice(start);
}

function maskCommentsAndStrings(source) {
  let output = "";
  let mode = "code";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "line-comment") {
      if (char === "\n") {
        mode = "code";
        output += char;
      } else output += " ";
      continue;
    }
    if (mode === "block-comment") {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        mode = "code";
      } else output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (mode === "string") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") mode = "code";
      output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      mode = "line-comment";
    } else if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      mode = "block-comment";
    } else if (char === "\"") {
      output += " ";
      mode = "string";
    } else {
      output += char;
    }
  }
  return output;
}

function compact(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function tailscaleIPv4() {
  const result = spawnSync("tailscale", ["ip", "-4"], { encoding: "utf8" });
  if (result.status !== 0) return "";
  const candidate = String(result.stdout || "")
    .split(/\s+/)
    .find((value) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value));
  if (!candidate) return "";
  const octets = candidate.split(".").map(Number);
  return octets.every((value) => value >= 0 && value <= 255) ? candidate : "";
}

function result(route, hotReloadable, reason, paths) {
  return {
    route,
    hotReloadable,
    reason,
    before: paths.beforePath || "",
    after: paths.afterPath || "",
  };
}
