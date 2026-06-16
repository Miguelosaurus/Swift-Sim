#!/usr/bin/env node
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { URL } from "node:url";
import { parseArgs } from "node:util";
import {
  ServeSimAdapter,
  ServeSimError,
} from "../src/serveSimAdapter.js";
import { SessionStore } from "../src/sessionStore.js";
import { PairingStore } from "../src/pairingStore.js";
import {
  badRequest,
  json,
  notFound,
  readJson,
  text,
  unauthorized,
} from "../src/http.js";
import { buildCompanionLinks, buildPairingLinks, codexSession, publicSession } from "../src/links.js";

const DEFAULT_PORT = Number(process.env.SWIFT_SIM_PORT || 47217);
const DEFAULT_HOST = process.env.SWIFT_SIM_HOST || "127.0.0.1";

const store = new SessionStore();
const pairingStore = new PairingStore();
const adapter = new ServeSimAdapter();

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const [command = "serve", ...rest] = process.argv.slice(2);

  if (command === "serve") {
    const { values } = parseArgs({
      args: rest,
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string" },
      },
    });
    await serve({
      port: values.port ? Number(values.port) : DEFAULT_PORT,
      host: values.host || DEFAULT_HOST,
    });
    return;
  }

  if (command === "start-session") {
    const { values } = parseArgs({
      args: rest,
      options: commonSessionOptions(),
    });
    const session = await startOrReuseSession(values, { includeCodexMetadata: true });
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  if (command === "companion-link") {
    const { values } = parseArgs({
      args: rest,
      options: {
        "session-id": { type: "string" },
        token: { type: "string" },
        "remote-base-url": { type: "string" },
      },
    });
    const session = store.get(values["session-id"]);
    if (!session) throw new Error("Unknown session id.");
    ensureToken(session, values.token);
    const links = buildCompanionLinks(session, values["remote-base-url"]);
    console.log(JSON.stringify(links, null, 2));
    return;
  }

  if (command === "pair") {
    const { values } = parseArgs({
      args: rest,
      options: {
        "remote-base-url": { type: "string" },
        rotate: { type: "boolean" },
      },
    });
    const pairing = values.rotate ? pairingStore.rotate() : pairingStore.current();
    const links = buildPairingLinks(pairing, values["remote-base-url"]);
    console.log(JSON.stringify({
      macName: pairing.macName,
      links,
    }, null, 2));
    return;
  }

  if (command === "setup-status") {
    const { values } = parseArgs({
      args: rest,
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string" },
      },
    });
    console.log(JSON.stringify(await setupStatus({
      host: values.host || DEFAULT_HOST,
      port: values.port ? Number(values.port) : DEFAULT_PORT,
    }), null, 2));
    return;
  }

  if (command === "stop-session") {
    const { values } = parseArgs({
      args: rest,
      options: {
        "session-id": { type: "string" },
        token: { type: "string" },
      },
    });
    const session = store.get(values["session-id"]);
    if (!session) throw new Error("Unknown session id.");
    ensureToken(session, values.token);
    await stopSession(session.id);
    console.log(JSON.stringify({ stopped: true, sessionId: session.id }));
    return;
  }

  if (command === "serve-sim-info") {
    console.log(JSON.stringify(await adapter.inspect(), null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function commonSessionOptions() {
  return {
    project: { type: "string" },
    scheme: { type: "string" },
    simulator: { type: "string" },
    "remote-base-url": { type: "string" },
    port: { type: "string" },
  };
}

async function serve({ host, port }) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          helper: "swift-sim-helper",
        });
      }

      if (req.method === "GET" && url.pathname === "/.well-known/apple-app-site-association") {
        return json(res, 200, appleAppSiteAssociation());
      }

      if (req.method === "GET" && url.pathname === "/api/serve-sim") {
        if (!pairingTokenMatches(req, url)) {
          return unauthorized(res);
        }
        return json(res, 200, await adapter.inspect());
      }

      if (req.method === "GET" && url.pathname === "/api/pairing/status") {
        if (!pairingStore.tokenMatches(url.searchParams.get("token"))) {
          return unauthorized(res);
        }
        return json(res, 200, pairingStore.status());
      }

      if (req.method === "POST" && url.pathname === "/api/pairing/rotate") {
        if (!pairingStore.tokenMatches(url.searchParams.get("token"))) {
          return unauthorized(res);
        }
        const pairing = pairingStore.rotate();
        const remoteBaseUrl = url.searchParams.get("remoteBaseUrl") || "";
        return json(res, 200, {
          macName: pairing.macName,
          links: buildPairingLinks(pairing, remoteBaseUrl),
        });
      }

      if (req.method === "POST" && url.pathname === "/api/sessions/start") {
        if (!pairingTokenMatches(req, url)) {
          return unauthorized(res);
        }
        const body = await readJson(req);
        const session = await startOrReuseSession({
          project: body.project,
          scheme: body.scheme,
          simulator: body.simulatorUDID || body.simulator,
          "remote-base-url": body.remoteBaseUrl,
          port: body.port,
        });
        return json(res, 201, session);
      }

      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(logs|stop|links))?$/);
      if (sessionMatch) {
        const [, sessionId, action] = sessionMatch;
        const session = store.get(sessionId);
        if (!session) return notFound(res, "Unknown session.");
        if (!tokenMatches(session, url.searchParams.get("token"))) {
          return unauthorized(res);
        }
        if (req.method === "GET" && !action) {
          return json(res, 200, publicSession(session));
        }
        if (req.method === "GET" && action === "logs") {
          return json(res, 200, { sessionId, logs: session.logs.slice(-200) });
        }
        if (req.method === "POST" && action === "stop") {
          await stopSession(sessionId);
          return json(res, 200, { stopped: true, sessionId });
        }
        if (req.method === "GET" && action === "links") {
          return json(res, 200, buildCompanionLinks(session, session.remoteBaseUrl));
        }
      }

      const streamMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
      if (streamMatch && req.method === "GET") {
        const [, sessionId] = streamMatch;
        const session = store.get(sessionId);
        if (!session) return notFound(res, "Unknown session.");
        if (!tokenMatches(session, url.searchParams.get("token"))) {
          return unauthorized(res);
        }
        return proxyStream(res, session);
      }

      const typeMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/type$/);
      if (typeMatch && req.method === "POST") {
        const [, sessionId] = typeMatch;
        const session = store.get(sessionId);
        if (!session) return notFound(res, "Unknown session.");
        if (!tokenMatches(session, url.searchParams.get("token"))) {
          return unauthorized(res);
        }
        const body = await readJson(req);
        const result = await typeIntoSimulator(session, body.text || "");
        return json(res, 200, result);
      }

      const tapMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/tap$/);
      if (tapMatch && req.method === "POST") {
        const [, sessionId] = tapMatch;
        const session = store.get(sessionId);
        if (!session) return notFound(res, "Unknown session.");
        if (!tokenMatches(session, url.searchParams.get("token"))) {
          return unauthorized(res);
        }
        const body = await readJson(req);
        const result = await tapSimulator(session, body.x, body.y);
        return json(res, 200, result);
      }

      const gestureMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/gesture$/);
      if (gestureMatch && req.method === "POST") {
        const [, sessionId] = gestureMatch;
        const session = store.get(sessionId);
        if (!session) return notFound(res, "Unknown session.");
        if (!tokenMatches(session, url.searchParams.get("token"))) {
          return unauthorized(res);
        }
        const body = await readJson(req);
        const result = await sendGesture(session, body);
        return json(res, 200, result);
      }

      const controlMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/control\/([a-z-]+)$/);
      if (controlMatch && req.method === "POST") {
        const [, sessionId, control] = controlMatch;
        const session = store.get(sessionId);
        if (!session) return notFound(res, "Unknown session.");
        if (!tokenMatches(session, url.searchParams.get("token"))) {
          return unauthorized(res);
        }
        const result = await sendControl(session, control);
        return json(res, 200, result);
      }

      const webMatch = url.pathname.match(/^\/s\/([^/]+)$/);
      if (webMatch) {
        const session = store.get(webMatch[1]);
        if (!session) return notFound(res, "Unknown session.");
        if (!tokenMatches(session, url.searchParams.get("token"))) {
          return unauthorized(res);
        }
        return text(res, 200, sessionFallbackHtml(session), "text/html; charset=utf-8");
      }

      if (req.method === "GET" && url.pathname === "/pair") {
        const token = url.searchParams.get("token") || "";
        const base = `${url.protocol}//${url.host}`;
        return text(res, 200, pairingFallbackHtml({ token, base }), "text/html; charset=utf-8");
      }

      return notFound(res, "Not found.");
    } catch (error) {
      const status = error instanceof ServeSimError ? 502 : 400;
      return badRequest(res, status, error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      console.log(`swift-sim-helper listening at http://${host}:${port}`);
      console.log("Expose privately with: tailscale serve " + port);
      resolve();
    });
  });

  const keepAlive = setInterval(() => {}, 60 * 60 * 1000);
  process.once("SIGTERM", () => {
    clearInterval(keepAlive);
    server.close(() => process.exit(0));
  });
  process.once("SIGINT", () => {
    clearInterval(keepAlive);
    server.close(() => process.exit(0));
  });
  await new Promise(() => {});
}

async function setupStatus({ host, port }) {
  const [tailscale, serveStatus, helperHealth] = await Promise.all([
    readTailscaleStatus(),
    readTailscaleServeStatus(port),
    readHelperHealth(host, port),
  ]);
  const defaultRemoteBaseUrl = tailscale.dnsName ? `https://${tailscale.dnsName.replace(/\.$/, "")}` : "";
  const remoteBaseUrl = serveStatus.remoteBaseUrl || defaultRemoteBaseUrl;
  const nextSteps = [];

  if (!tailscale.available) {
    nextSteps.push("Install Tailscale on the Mac and sign in to the same Tailnet as the iPhone.");
  } else if (!tailscale.online) {
    nextSteps.push("Open Tailscale on the Mac and connect it.");
  }

  if (!helperHealth.ok) {
    nextSteps.push(`Start the Swift Sim helper: node mac-helper/bin/swift-sim-helper.js serve --host ${host} --port ${port}`);
  }

  if (tailscale.online && !serveStatus.configured) {
    nextSteps.push(`Expose the helper privately: ${tailscaleServeCommand(tailscale.mode, port)}`);
  }

  if (remoteBaseUrl && helperHealth.ok && serveStatus.configured) {
    nextSteps.push(`Generate an iPhone pairing link: node mac-helper/bin/swift-sim-helper.js pair --remote-base-url ${remoteBaseUrl}`);
  }

  return {
    ok: tailscale.online && helperHealth.ok && serveStatus.configured,
    helper: helperHealth,
    tailscale,
    tailscaleServe: serveStatus,
    suggestedRemoteBaseUrl: remoteBaseUrl,
    nextSteps,
  };
}

async function readTailscaleStatus() {
  const { result, mode } = await runTailscale(["status", "--json"]);
  if (result.error) {
    const timedOut = result.error.includes("timed out");
    return {
      available: timedOut,
      online: false,
      backendState: "",
      dnsName: "",
      error: result.error,
      mode,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return {
      available: true,
      online: Boolean(parsed.Self?.Online),
      backendState: parsed.BackendState || "",
      dnsName: parsed.Self?.DNSName || "",
      tailnet: parsed.CurrentTailnet?.Name || "",
      mode,
    };
  } catch (error) {
    return {
      available: true,
      online: false,
      backendState: "",
      dnsName: "",
      error: error instanceof Error ? error.message : String(error),
      mode,
    };
  }
}

async function readTailscaleServeStatus(port) {
  const { result, mode } = await runTailscale(["serve", "status"]);
  if (result.error) {
    return {
      configured: false,
      error: result.error,
      raw: "",
      mode,
    };
  }
  return {
    configured: result.stdout.includes(String(port)),
    remoteBaseUrl: parseServeRemoteBaseUrl(result.stdout, port),
    raw: result.stdout.trim(),
    mode,
  };
}

async function runTailscale(args) {
  let fallback = { result: { error: "tailscale not checked", stdout: "", stderr: "", code: null }, mode: "default" };
  for (const candidate of tailscaleCandidates()) {
    const result = await runCommand("tailscale", [...candidate.args, ...args], { timeoutMs: 2500 });
    if (!result.error) return { result, mode: candidate.mode };
    fallback = { result, mode: candidate.mode };
  }
  return fallback;
}

function tailscaleCandidates() {
  const candidates = [{ mode: "default", args: [] }];
  const userspaceSocket = `${homedir()}/.tailscale-userspace/tailscaled.sock`;
  if (existsSync(userspaceSocket)) {
    candidates.push({ mode: "userspace", args: [`--socket=${userspaceSocket}`] });
  }
  return candidates;
}

function tailscaleServeCommand(mode, port) {
  if (mode === "userspace") {
    return `tailscale --socket ~/.tailscale-userspace/tailscaled.sock serve ${port}`;
  }
  return `tailscale serve ${port}`;
}

function parseServeRemoteBaseUrl(output, port) {
  let currentUrl = "";
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("https://")) {
      currentUrl = trimmed.split(/\s+/)[0].replace(/\/$/, "");
      continue;
    }
    if (currentUrl && trimmed.includes(`proxy http://127.0.0.1:${port}`)) {
      return currentUrl;
    }
  }
  return "";
}

async function readHelperHealth(host, port) {
  try {
    const response = await fetchWithTimeout(`http://${host}:${port}/health`, 1200);
    return {
      ok: response.ok,
      url: `http://${host}:${port}`,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      url: `http://${host}:${port}`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runCommand(command, args, { timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({ code: null, stdout, stderr, error: `${command} ${args.join(" ")} timed out` });
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error: error.message });
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr,
        error: code === 0 ? "" : (stderr || stdout || `${command} exited with code ${code}`),
      });
    });
  });
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function proxyStream(res, session) {
  const streamUrl = session.stream.localUrl || "";
  if (!streamUrl) {
    return badRequest(res, 404, "Stream is not ready.");
  }
  const upstream = await fetch(streamUrl);
  if (!upstream.ok || !upstream.body) {
    return badRequest(res, 502, `Stream upstream failed with status ${upstream.status}.`);
  }
  res.writeHead(200, {
    "content-type": upstream.headers.get("content-type") || "application/octet-stream",
    "cache-control": "no-store",
  });
  Readable.fromWeb(upstream.body).pipe(res);
}

async function startOrReuseSession(input, { includeCodexMetadata = false } = {}) {
  const simulatorUDID = required(input.simulator, "simulator");
  const existing = store.findReusable({
    project: input.project || "",
    scheme: input.scheme || "",
    simulatorUDID,
  });
  if (existing && existing.stream.state === "running") {
    existing.remoteBaseUrl = input["remote-base-url"] || existing.remoteBaseUrl;
    existing.updatedAt = new Date().toISOString();
    store.save(existing);
    return includeCodexMetadata ? codexSession(existing) : publicSession(existing);
  }

  const session = store.create({
    project: input.project || "",
    scheme: input.scheme || "",
    simulatorUDID,
    token: randomBytes(24).toString("base64url"),
    remoteBaseUrl: input["remote-base-url"] || "",
  });
  session.logs.push(`starting serve-sim for ${simulatorUDID}`);

  const result = await adapter.start({
    simulatorUDID,
    port: input.port ? Number(input.port) : undefined,
  });
  session.stream = {
    state: "running",
    localUrl: result.previewUrl,
    port: result.port,
    pid: result.pid,
    raw: result.raw,
  };
  session.logs.push(...result.logs);
  store.save(session);
  return includeCodexMetadata ? codexSession(session) : publicSession(session);
}

async function stopSession(sessionId) {
  const session = store.get(sessionId);
  if (!session) return;
  session.logs.push(`stopping serve-sim for ${session.simulatorUDID}`);
  await adapter.kill(session.simulatorUDID);
  session.stream.state = "stopped";
  session.updatedAt = new Date().toISOString();
  store.save(session);
}

async function sendControl(session, control) {
  if (control === "home") {
    await adapter.button({ simulatorUDID: session.simulatorUDID, name: "home" });
  } else if (control === "lock") {
    await adapter.button({ simulatorUDID: session.simulatorUDID, name: "lock" });
  } else if (control === "rotate" || control === "rotate-right") {
    const next = session.orientation === "landscape_right" ? "portrait" : "landscape_right";
    await adapter.rotate({ simulatorUDID: session.simulatorUDID, orientation: next });
    session.orientation = next;
  } else if (control === "rotate-left") {
    const next = session.orientation === "landscape_left" ? "portrait" : "landscape_left";
    await adapter.rotate({ simulatorUDID: session.simulatorUDID, orientation: next });
    session.orientation = next;
  } else if (control === "siri") {
    await adapter.button({ simulatorUDID: session.simulatorUDID, name: "siri" });
  } else if (control === "side-button") {
    await adapter.button({ simulatorUDID: session.simulatorUDID, name: "side" });
  } else if (control === "action-button") {
    await adapter.button({ simulatorUDID: session.simulatorUDID, name: "action" });
  } else if (control === "text-size-increment") {
    await adapter.ui({ simulatorUDID: session.simulatorUDID, args: ["text-size", "increment"] });
  } else if (control === "increase-contrast") {
    await toggleSimulatorUI(session.simulatorUDID, "increase-contrast");
  } else {
    throw new Error(`Unsupported control: ${control}`);
  }
  session.logs.push(`control: ${control}`);
  store.save(session);
  return { ok: true, control };
}

async function toggleSimulatorUI(simulatorUDID, option) {
  const current = await adapter.ui({ simulatorUDID, args: [option] });
  const next = String(current.stdout || "").trim().toLowerCase() === "on" ? "off" : "on";
  await adapter.ui({ simulatorUDID, args: [option, next] });
}

async function typeIntoSimulator(session, typedText) {
  if (!typedText || typeof typedText !== "string") {
    throw new Error("Missing text.");
  }
  await adapter.type({ simulatorUDID: session.simulatorUDID, text: typedText });
  session.logs.push(`typed ${typedText.length} characters`);
  store.save(session);
  return { ok: true };
}

async function tapSimulator(session, x, y) {
  const normalizedX = Number(x);
  const normalizedY = Number(y);
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new Error("Missing tap coordinates.");
  }
  const clampedX = Math.max(0, Math.min(1, normalizedX));
  const clampedY = Math.max(0, Math.min(1, normalizedY));
  await adapter.tap({
    simulatorUDID: session.simulatorUDID,
    x: clampedX,
    y: clampedY,
  });
  session.logs.push(`tap: ${clampedX.toFixed(3)}, ${clampedY.toFixed(3)}`);
  store.save(session);
  return { ok: true, x: clampedX, y: clampedY };
}

async function sendGesture(session, event) {
  const normalized = normalizeGestureEvent(event);
  await adapter.gesture({
    simulatorUDID: session.simulatorUDID,
    event: normalized,
  });
  session.logs.push(`gesture: ${normalized.type} ${normalized.x.toFixed(3)}, ${normalized.y.toFixed(3)}`);
  store.save(session);
  return { ok: true, event: normalized };
}

function normalizeGestureEvent(event) {
  if (!event || typeof event !== "object") {
    throw new Error("Missing gesture event.");
  }
  const type = String(event.type || "");
  if (!["begin", "move", "end"].includes(type)) {
    throw new Error("Unsupported gesture type.");
  }
  const x = Number(event.x);
  const y = Number(event.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Missing gesture coordinates.");
  }
  return {
    type,
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

function required(value, name) {
  if (!value || typeof value !== "string") {
    throw new Error(`Missing required ${name}.`);
  }
  return value;
}

function ensureToken(session, token) {
  if (!tokenMatches(session, token)) throw new Error("Invalid session token.");
}

function pairingTokenMatches(req, url) {
  const header = req.headers.authorization || "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return pairingStore.tokenMatches(bearer || url.searchParams.get("token"));
}

function tokenMatches(session, token) {
  return Boolean(token && token === session.token);
}

function sessionFallbackHtml(session) {
  const links = buildCompanionLinks(session, session.remoteBaseUrl);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Swift Sim Session</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f7fafc; color: #0f1115; }
    main { width: min(520px, calc(100vw - 36px)); padding: 28px; border-radius: 34px; background: rgba(255,255,255,.78); box-shadow: 0 24px 70px rgba(31,44,64,.12); }
    h1 { margin: 0 0 8px; font-size: 34px; line-height: 1.04; }
    p { color: #626b76; font-size: 17px; line-height: 1.4; }
    a.button { display: block; margin-top: 18px; padding: 16px 18px; border-radius: 999px; color: white; background: #1683ff; text-align: center; text-decoration: none; font-weight: 800; }
    code { display: block; margin-top: 16px; padding: 14px; border-radius: 18px; background: rgba(128,128,128,.12); color: #5b6570; word-break: break-all; font-size: 13px; }
    @media (prefers-color-scheme: dark) {
      body { background: #05070a; color: #f5f7fa; }
      main { background: rgba(28,31,36,.82); }
    }
  </style>
</head>
<body>
  <main>
    <h1>Swift Sim</h1>
    <p>This browser page is only a fallback. Open the native companion app to view and control the live Mac Simulator.</p>
    <a class="button" href="${escapeHtml(links.customScheme)}">Open Simulator in Companion App</a>
    <p>If that button does not switch apps, paste this link into Swift Sim:</p>
    <code>${escapeHtml(links.customScheme)}</code>
  </main>
</body>
</html>`;
}

function pairingFallbackHtml({ token, base }) {
  const customScheme = `swift-sim://pair?token=${encodeURIComponent(token)}&base=${encodeURIComponent(base)}`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pair Swift Sim</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f8fbff; color: #121417; }
    main { max-width: 560px; margin: 0 auto; padding: 40px 22px; }
    a.button { display: inline-block; margin-top: 18px; padding: 14px 18px; border-radius: 999px; color: white; background: #1677ff; text-decoration: none; font-weight: 700; }
    code { display: block; margin-top: 18px; padding: 14px; border-radius: 14px; background: white; word-break: break-all; }
  </style>
</head>
<body>
  <main>
    <h1>Pair Swift Sim</h1>
    <p>Open this link on your iPhone to pair the companion app with this Mac helper over your private Tailscale connection.</p>
    <a class="button" href="${escapeHtml(customScheme)}">Open Swift Sim Companion</a>
    <code>${escapeHtml(customScheme)}</code>
  </main>
</body>
</html>`;
}

function appleAppSiteAssociation() {
  const appId = process.env.SWIFT_SIM_IOS_APP_ID || "TEAMID.dev.local.SwiftSimCompanion";
  return {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [appId],
          components: [
            {
              "/": "/s/*",
              comment: "Open Swift Sim companion sessions.",
            },
            {
              "/": "/pair",
              comment: "Pair Swift Sim companion with this Mac helper.",
            },
          ],
        },
      ],
    },
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
