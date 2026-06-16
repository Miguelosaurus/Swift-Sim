#!/usr/bin/env node
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
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
import { buildCompanionLinks, buildPairingLinks, publicSession } from "../src/links.js";

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
    const session = await startOrReuseSession(values);
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
          sessions: store.list().length,
          macName: pairingStore.current().macName,
        });
      }

      if (req.method === "GET" && url.pathname === "/.well-known/apple-app-site-association") {
        return json(res, 200, appleAppSiteAssociation());
      }

      if (req.method === "GET" && url.pathname === "/api/serve-sim") {
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

      const controlMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/control\/(home|lock|rotate)$/);
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

  server.listen(port, host, () => {
    console.log(`swift-sim-helper listening at http://${host}:${port}`);
    console.log("Expose privately with: tailscale serve " + port);
  });
}

async function startOrReuseSession(input) {
  const simulatorUDID = required(input.simulator, "simulator");
  const existing = store.findReusable({
    project: input.project || "",
    scheme: input.scheme || "",
    simulatorUDID,
  });
  if (existing && existing.stream.state === "running") {
    existing.remoteBaseUrl = input["remote-base-url"] || existing.remoteBaseUrl;
    existing.updatedAt = new Date().toISOString();
    return publicSession(existing);
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
  return publicSession(session);
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
  } else if (control === "rotate") {
    const next = session.orientation === "landscape_left" ? "portrait" : "landscape_left";
    await adapter.rotate({ simulatorUDID: session.simulatorUDID, orientation: next });
    session.orientation = next;
  }
  session.logs.push(`control: ${control}`);
  store.save(session);
  return { ok: true, control };
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

function tokenMatches(session, token) {
  return Boolean(token && token === session.token);
}

function sessionFallbackHtml(session) {
  const links = buildCompanionLinks(session, session.remoteBaseUrl);
  const streamUrl = session.stream.localUrl || "";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Swift Sim Session</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #101214; color: #f5f7fa; }
    main { max-width: 720px; margin: 0 auto; padding: 32px 20px; }
    a { color: #8fc7ff; }
    .frame { margin-top: 24px; overflow: hidden; border: 1px solid #2a3138; border-radius: 16px; background: #050607; }
    iframe { display: block; width: 100%; height: 72vh; border: 0; }
    code { color: #c8d5e2; word-break: break-all; }
  </style>
</head>
<body>
  <main>
    <h1>Swift Sim</h1>
    <p>Open this session in the companion app:</p>
    <p><a href="${escapeHtml(links.customScheme)}">Open Simulator in Companion App</a></p>
    <p><code>${escapeHtml(links.universalLink || links.customScheme)}</code></p>
    ${streamUrl ? `<div class="frame"><iframe src="${escapeHtml(streamUrl)}"></iframe></div>` : ""}
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
