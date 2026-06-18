#!/usr/bin/env node
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { URL } from "node:url";
import { parseArgs } from "node:util";
import {
  ServeSimAdapter,
  ServeSimError,
} from "../src/serveSimAdapter.js";
import { ServeSimTransport } from "../src/transports/serveSimTransport.js";
import { NativeCompanionTransport } from "../src/transports/nativeCompanionTransport.js";
import { SessionStore } from "../src/sessionStore.js";
import { PairingStore } from "../src/pairingStore.js";
import { SimulatorProfileResolver } from "../src/simulatorProfile.js";
import { namedKeyEvents, textToKeyEvents } from "../src/keyboard.js";
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
const simulatorProfiles = new SimulatorProfileResolver();
const adapter = new ServeSimAdapter();
const transports = {
  "serve-sim": new ServeSimTransport({ adapter }),
  "native-companion": new NativeCompanionTransport({ adapter }),
};

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
    transport: { type: "string" },
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

      if (req.method === "GET" && url.pathname === "/api/transports") {
        if (!pairingTokenMatches(req, url)) {
          return unauthorized(res);
        }
        return json(res, 200, {
          default: defaultTransportPreference(),
          transports: await inspectTransports(),
        });
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
          transport: body.transport,
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

      const frameMaskMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/frame-mask$/);
      if (frameMaskMatch && req.method === "GET") {
        const [, sessionId] = frameMaskMatch;
        const session = store.get(sessionId);
        if (!session) return notFound(res, "Unknown session.");
        if (!tokenMatches(session, url.searchParams.get("token"))) {
          return unauthorized(res);
        }
        const mask = simulatorProfiles.readMask(session.simulatorUDID);
        if (!mask) return notFound(res, "Simulator frame mask is unavailable.");
        res.writeHead(200, {
          "content-type": mask.contentType,
          "content-length": mask.data.length,
          "cache-control": "private, max-age=86400",
          "x-swift-sim-frame-width": mask.width,
          "x-swift-sim-frame-height": mask.height,
        });
        return res.end(mask.data);
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

      const keyMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/key$/);
      if (keyMatch && req.method === "POST") {
        const [, sessionId] = keyMatch;
        const session = store.get(sessionId);
        if (!session) return notFound(res, "Unknown session.");
        if (!tokenMatches(session, url.searchParams.get("token"))) {
          return unauthorized(res);
        }
        const body = await readJson(req);
        const result = await sendNamedKey(session, body.key || "");
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
  const [tailscale, serveStatus, helperHealth, transportInfo] = await Promise.all([
    readTailscaleStatus(),
    readTailscaleServeStatus(port),
    readHelperHealth(host, port),
    inspectTransports(),
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
    transport: {
      default: defaultTransportPreference(),
      activeForPhone: preferredPhoneTransport(transportInfo),
      transports: transportInfo,
    },
    suggestedRemoteBaseUrl: remoteBaseUrl,
    nextSteps,
  };
}

async function inspectTransports() {
  return Object.fromEntries(await Promise.all(
    Object.entries(transports).map(async ([id, transport]) => [id, await transport.inspect()])
  ));
}

function defaultTransportPreference() {
  return process.env.SWIFT_SIM_TRANSPORT || "auto";
}

function preferredPhoneTransport(info) {
  if (info["native-companion"]?.available) {
    return "native-companion";
  }
  return "serve-sim";
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
  if (!session.stream.localUrl) {
    return badRequest(res, 404, "Stream is not ready.");
  }

  let source;
  try {
    source = await openStreamingSource(session);
  } catch (error) {
    session.logs.push(`stream produced no media; restarting serve-sim: ${error instanceof Error ? error.message : String(error)}`);
    store.save(session);
    await restartStreamOnce(session);
    try {
      source = await openStreamingSource(session, 8_000);
    } catch (retryError) {
      return badRequest(res, 502, retryError instanceof Error ? retryError.message : String(retryError));
    }
  }

  res.writeHead(200, {
    "content-type": source.contentType,
    "cache-control": "no-store",
  });
  await writeChunk(res, source.firstChunk);

  while (!res.destroyed && !res.writableEnded) {
    try {
      const result = await readStreamChunk(source.reader, 5_000);
      if (result.done) throw new Error("Simulator stream ended.");
      await writeChunk(res, result.value);
    } catch (error) {
      try { await source.reader.cancel(); } catch {}
      session.logs.push(`stream stalled; recovering tracked simulator: ${error instanceof Error ? error.message : String(error)}`);
      store.save(session);
      try {
        await restartStreamOnce(session);
        source = await openStreamingSource(session, 8_000);
        await writeChunk(res, source.firstChunk);
      } catch (recoveryError) {
        session.logs.push(`stream recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
        store.save(session);
        res.destroy(recoveryError instanceof Error ? recoveryError : undefined);
        return;
      }
    }
  }
}

async function openStreamingSource(session, timeoutMs = 5_000) {
  const upstream = await fetchWithTimeout(session.stream.localUrl, timeoutMs);
  if (!upstream.ok || !upstream.body) {
    throw new Error(`Stream upstream failed with status ${upstream.status}.`);
  }
  const reader = upstream.body.getReader();
  const first = await readStreamChunk(reader, timeoutMs);
  if (first.done || !first.value?.byteLength) {
    try { await reader.cancel(); } catch {}
    throw new Error("Simulator stream returned no media bytes.");
  }
  return {
    reader,
    firstChunk: first.value,
    contentType: upstream.headers.get("content-type") || "application/octet-stream",
  };
}

function readStreamChunk(reader, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Simulator media timed out.")), timeoutMs);
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function writeChunk(res, chunk) {
  if (!chunk?.byteLength || res.destroyed || res.writableEnded) return;
  if (!res.write(Buffer.from(chunk))) await once(res, "drain");
}

const streamRestarts = new Map();

function restartStreamOnce(session) {
  const key = session.simulatorUDID;
  const current = streamRestarts.get(key);
  if (current) return current;
  const restart = restartStream(session).finally(() => streamRestarts.delete(key));
  streamRestarts.set(key, restart);
  return restart;
}

async function restartStream(session) {
  closeInputChannel(session);
  const transport = transportForSession(session);
  const stream = await transport.restart(session);
  session.stream = publicStream(stream);
  session.logs.push(`restarted ${session.stream.transport} stream`);
  session.logs.push(...(stream.logs || []));
  store.save(session);
}

async function startOrReuseSession(input, { includeCodexMetadata = false } = {}) {
  const simulatorUDID = required(input.simulator, "simulator");
  const transportPreference = input.transport || defaultTransportPreference();
  const existing = store.findReusable({
    project: input.project || "",
    scheme: input.scheme || "",
    simulatorUDID,
  });
  if (existing && existing.stream.state === "running" && transportMatches(existing, transportPreference)) {
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
    transport: resolveTransportPreference(transportPreference),
  });
  session.logs.push(`starting ${session.stream.transport} transport for ${simulatorUDID}`);

  let transport = transportForSession(session);
  let stream;
  try {
    stream = await transport.start({
      simulatorUDID,
      port: input.port ? Number(input.port) : undefined,
    });
  } catch (error) {
    if (transportPreference !== "auto" || session.stream.transport !== "native-companion") {
      throw error;
    }
    session.logs.push(`native companion unavailable; using serve-sim fallback: ${error instanceof Error ? error.message : String(error)}`);
    session.stream.transport = "serve-sim";
    transport = transportForSession(session);
    stream = await transport.start({
      simulatorUDID,
      port: input.port ? Number(input.port) : undefined,
    });
  }
  session.stream = publicStream(stream);
  session.logs.push(...(stream.logs || []));
  store.save(session);
  return includeCodexMetadata ? codexSession(session) : publicSession(session);
}

async function stopSession(sessionId) {
  const session = store.get(sessionId);
  if (!session) return;
  session.logs.push(`stopping ${session.stream.transport || "serve-sim"} for ${session.simulatorUDID}`);
  await transportForSession(session).stop(session);
  closeInputChannel(session);
  session.stream.state = "stopped";
  session.updatedAt = new Date().toISOString();
  store.save(session);
}

function transportMatches(session, preference) {
  const resolved = resolveTransportPreference(preference);
  return (session.stream.transport || "serve-sim") === resolved;
}

function resolveTransportPreference(preference = "auto") {
  if (preference === "auto") {
    return process.env.SWIFT_SIM_DISABLE_NATIVE_TRANSPORT === "1" ? "serve-sim" : "native-companion";
  }
  if (transports[preference]) return preference;
  throw new Error(`Unknown transport: ${preference}`);
}

function transportForSession(session) {
  const id = session.stream.transport || "serve-sim";
  const transport = transports[id];
  if (!transport) throw new Error(`Unknown session transport: ${id}`);
  return transport;
}

function publicStream(stream) {
  return {
    state: stream.state,
    transport: stream.transport,
    quality: stream.quality,
    localUrl: stream.localUrl || "",
    previewUrl: stream.previewUrl || stream.localUrl || "",
    wsUrl: stream.wsUrl || "",
    port: stream.port,
    pid: stream.pid,
    raw: stream.raw || {},
    limitations: stream.limitations || [],
  };
}

async function sendControl(session, control) {
  if (control === "home") {
    await sendButton(session, "home");
  } else if (control === "lock") {
    await sendButton(session, "lock");
  } else if (control === "rotate" || control === "rotate-right") {
    const next = session.orientation === "landscape_right" ? "portrait" : "landscape_right";
    await sendRotation(session, next);
    session.orientation = next;
  } else if (control === "rotate-left") {
    const next = session.orientation === "landscape_left" ? "portrait" : "landscape_left";
    await sendRotation(session, next);
    session.orientation = next;
  } else if (control === "siri") {
    await sendButton(session, "siri");
  } else if (control === "side-button") {
    await sendButton(session, "side");
  } else if (control === "action-button") {
    await sendButton(session, "action");
  } else if (control === "text-size-increment") {
    await adapter.ui({ simulatorUDID: session.simulatorUDID, args: ["text-size", "increment"] });
  } else if (control === "text-size-decrement") {
    await adapter.ui({ simulatorUDID: session.simulatorUDID, args: ["text-size", "decrement"] });
  } else if (control === "increase-contrast") {
    await toggleSimulatorUI(session.simulatorUDID, "increase-contrast");
  } else if (control === "reduce-motion") {
    await toggleSimulatorUI(session.simulatorUDID, "reduce-motion");
  } else if (control === "reduce-transparency") {
    await toggleSimulatorUI(session.simulatorUDID, "reduce-transparency");
  } else if (control === "show-borders") {
    await toggleSimulatorUI(session.simulatorUDID, "show-borders");
  } else if (control === "appearance-light") {
    await adapter.ui({ simulatorUDID: session.simulatorUDID, args: ["appearance", "light"] });
  } else if (control === "appearance-dark") {
    await adapter.ui({ simulatorUDID: session.simulatorUDID, args: ["appearance", "dark"] });
  } else if (control === "liquid-glass-clear") {
    await adapter.ui({ simulatorUDID: session.simulatorUDID, args: ["liquid-glass", "clear"] });
  } else if (control === "liquid-glass-tinted") {
    await adapter.ui({ simulatorUDID: session.simulatorUDID, args: ["liquid-glass", "tinted"] });
  } else if (control === "memory-warning") {
    await sendMemoryWarning(session);
  } else if (control === "slow-animations") {
    await toggleCADebug(session, "slow-animations");
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

const caDebugStates = new Map();

async function toggleCADebug(session, option) {
  const key = `${session.simulatorUDID}:${option}`;
  const next = caDebugStates.get(key) === "on" ? "off" : "on";
  await sendCADebug(session, option, next === "on");
  caDebugStates.set(key, next);
}

async function typeIntoSimulator(session, typedText) {
  if (!typedText || typeof typedText !== "string") {
    throw new Error("Missing text.");
  }
  await sendKeyboardEvents(session, textToKeyEvents(typedText));
  session.logs.push(`typed ${typedText.length} characters`);
  store.save(session);
  return { ok: true };
}

async function sendNamedKey(session, key) {
  await sendKeyboardEvents(session, namedKeyEvents(key));
  return { ok: true, key };
}

async function sendKeyboardEvents(session, events) {
  for (const event of events) {
    await sendServeSimMessage(session, 6, event);
    await sleep(4);
  }
}

async function tapSimulator(session, x, y) {
  const normalizedX = Number(x);
  const normalizedY = Number(y);
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new Error("Missing tap coordinates.");
  }
  const clampedX = Math.max(0, Math.min(1, normalizedX));
  const clampedY = Math.max(0, Math.min(1, normalizedY));
  await sendTouch(session, { type: "begin", x: clampedX, y: clampedY });
  await sleep(40);
  await sendTouch(session, { type: "end", x: clampedX, y: clampedY });
  session.logs.push(`tap: ${clampedX.toFixed(3)}, ${clampedY.toFixed(3)}`);
  store.save(session);
  return { ok: true, x: clampedX, y: clampedY };
}

async function sendGesture(session, event) {
  const normalized = normalizeGestureEvent(event);
  await sendTouch(session, normalized);
  session.logs.push(`gesture: ${normalized.type} ${normalized.x.toFixed(3)}, ${normalized.y.toFixed(3)}`);
  store.save(session);
  return { ok: true, event: normalized };
}

async function sendTouch(session, payload) {
  await sendServeSimMessage(session, 3, payload);
}

async function sendButton(session, button) {
  await sendServeSimMessage(session, 4, { button });
}

async function sendRotation(session, orientation) {
  await sendServeSimMessage(session, 7, { orientation });
}

async function sendCADebug(session, option, enabled) {
  const options = {
    "slow-animations": "debug_slow_animations",
  };
  await sendServeSimMessage(session, 8, { option: options[option] || option, enabled });
}

async function sendMemoryWarning(session) {
  await sendServeSimMessage(session, 9);
}

function sessionWsUrl(session) {
  if (session.stream?.wsUrl) return session.stream.wsUrl;
  const raw = `${session.stream?.raw?.stdout || ""}\n${session.stream?.raw?.stderr || ""}`;
  const rawWsUrl = raw.match(/wss?:\/\/[^\s"'<>]+/)?.[0];
  if (rawWsUrl) return rawWsUrl;
  if (session.stream?.port) return `ws://127.0.0.1:${session.stream.port}/ws`;
  if (session.stream?.localUrl) {
    try {
      const localUrl = new URL(session.stream.localUrl);
      localUrl.protocol = localUrl.protocol === "https:" ? "wss:" : "ws:";
      localUrl.pathname = "/ws";
      localUrl.search = "";
      return localUrl.toString();
    } catch {
      return "";
    }
  }
  return "";
}

const inputChannels = new Map();

function sendServeSimMessage(session, opcode, payload) {
  const wsUrl = sessionWsUrl(session);
  if (!wsUrl) {
    return Promise.reject(new Error("Missing serve-sim WebSocket URL."));
  }
  let channel = inputChannels.get(wsUrl);
  if (!channel) {
    channel = new ServeSimInputChannel(wsUrl);
    inputChannels.set(wsUrl, channel);
  }
  return channel.send(opcode, payload);
}

function closeInputChannel(session) {
  const wsUrl = sessionWsUrl(session);
  const channel = inputChannels.get(wsUrl);
  channel?.close();
  inputChannels.delete(wsUrl);
}

class ServeSimInputChannel {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.connecting = null;
    this.pending = Promise.resolve();
  }

  send(opcode, payload) {
    const operation = this.pending.then(async () => {
      const socket = await this.connect();
      const encoded = payload === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(payload));
      const message = new Uint8Array(1 + encoded.length);
      message[0] = opcode;
      message.set(encoded, 1);
      socket.send(message);
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  connect() {
    if (this.socket?.readyState === 1) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.socket = null;
        this.connecting = null;
        try { socket.close(); } catch {}
        reject(new Error("Timed out connecting simulator controls."));
      }, 3_000);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        if (settled) {
          try { socket.close(); } catch {}
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.socket = socket;
        this.connecting = null;
        resolve(socket);
      };
      socket.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.socket = null;
        this.connecting = null;
        reject(new Error(`Failed to connect to serve-sim WebSocket at ${this.url}.`));
      };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
      };
    });
    return this.connecting;
  }

  close() {
    try { this.socket?.close(); } catch {}
    this.socket = null;
    this.connecting = null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGestureEvent(event) {
  if (!event || typeof event !== "object") {
    throw new Error("Missing gesture event.");
  }
  const type = String(event.type || "");
  if (!["begin", "move", "end", "pinch-begin", "pinch-move", "pinch-end"].includes(type)) {
    throw new Error("Unsupported gesture type.");
  }
  const x = Number(event.x);
  const y = Number(event.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Missing gesture coordinates.");
  }
  const normalized = {
    type,
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
  if (event.scale !== undefined) {
    const scale = Number(event.scale);
    if (Number.isFinite(scale)) normalized.scale = Math.max(0.1, Math.min(10, scale));
  }
  if (event.velocity !== undefined) {
    const velocity = Number(event.velocity);
    if (Number.isFinite(velocity)) normalized.velocity = Math.max(-20, Math.min(20, velocity));
  }
  return normalized;
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
  const customSchemeScript = JSON.stringify(links.customScheme);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Swift Sim Session</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #fbfcff; color: #0f1115; }
    main { width: min(480px, calc(100vw - 36px)); padding: 28px; border-radius: 34px; background: rgba(255,255,255,.82); box-shadow: 0 24px 70px rgba(31,44,64,.12); border: 1px solid rgba(20,30,45,.08); }
    .status { display: inline-flex; align-items: center; gap: 8px; color: #65707c; font-size: 15px; font-weight: 700; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #34c759; display: inline-block; }
    h1 { margin: 12px 0 8px; font-size: 34px; line-height: 1.04; }
    p { color: #626b76; font-size: 17px; line-height: 1.4; }
    a.button { display: block; margin-top: 18px; padding: 16px 18px; border-radius: 999px; color: white; background: #1683ff; text-align: center; text-decoration: none; font-weight: 800; }
    code { display: block; margin-top: 16px; padding: 14px; border-radius: 18px; background: rgba(128,128,128,.12); color: #5b6570; word-break: break-all; font-size: 13px; }
  </style>
  <script>
    window.addEventListener("load", () => {
      setTimeout(() => { window.location.href = ${customSchemeScript}; }, 250);
    });
  </script>
</head>
<body>
  <main>
    <div class="status"><span class="dot"></span>Opening native companion</div>
    <h1>Swift Sim</h1>
    <p>Safari is only the fallback handoff page. The simulator stream belongs in the native Swift Sim app.</p>
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
