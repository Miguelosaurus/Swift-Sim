import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { URL } from "node:url";
import { badRequest } from "./http.js";
import { namedKeyEvents, textToKeyEvents } from "./keyboard.js";
import { codexSession, publicSession } from "./links.js";
import { resolvedSessionTransport, sessionTransportMatches } from "./sessionTransportPreference.js";

export function createSessionRuntimeController(dependencies) {
  validateDependencies(dependencies);
  const { store, transports, adapter, defaultTransportPreference } = dependencies;

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
      session.logs.push(
        `stream produced no media; restarting serve-sim: ${error instanceof Error ? error.message : String(error)}`,
      );
      store.save(session);
      await restartStreamOnce(session);
      try {
        source = await openStreamingSource(session, 8_000);
      } catch (retryError) {
        return badRequest(
          res,
          502,
          retryError instanceof Error ? retryError.message : String(retryError),
        );
      }
    }

    res.writeHead(200, {
      "content-type": source.contentType,
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    });
    res.socket?.setNoDelay(true);

    const cancelActiveSource = () => {
      source?.reader.cancel().catch(() => {});
    };
    res.once("close", cancelActiveSource);

    try {
      await writeChunk(res, source.firstChunk);

      while (!res.destroyed && !res.writableEnded) {
        try {
          const result = await readStreamChunk(source.reader, 5_000);
          if (result.done) throw new Error("Simulator stream ended.");
          await writeChunk(res, result.value);
        } catch (error) {
          try {
            await source.reader.cancel();
          } catch {}
          if (res.destroyed || res.writableEnded) return;
          session.logs.push(
            `stream stalled; recovering tracked simulator: ${error instanceof Error ? error.message : String(error)}`,
          );
          store.save(session);
          try {
            await restartStreamOnce(session);
            source = await openStreamingSource(session, 8_000);
            await writeChunk(res, source.firstChunk);
          } catch (recoveryError) {
            session.logs.push(
              `stream recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
            );
            store.save(session);
            res.destroy(recoveryError instanceof Error ? recoveryError : undefined);
            return;
          }
        }
      }
    } finally {
      res.off("close", cancelActiveSource);
      try {
        await source?.reader.cancel();
      } catch {}
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
      try {
        await reader.cancel();
      } catch {}
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
      transport: transportPreference,
    });
    if (
      existing &&
      existing.stream.state === "running" &&
      sessionTransportMatches(existing.stream.transport, transportPreference)
    ) {
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
      transport: resolvedSessionTransport(transportPreference),
    });
    session.logs.push(`starting ${session.stream.transport} transport for ${simulatorUDID}`);

    let transport = transportForSession(session);
    let stream;
    try {
      try {
        stream = await transport.start({
          simulatorUDID,
          port: input.port ? Number(input.port) : undefined,
        });
      } catch (error) {
        if (transportPreference !== "auto" || session.stream.transport !== "native-companion") {
          throw error;
        }
        session.logs.push(
          `native companion unavailable; using serve-sim fallback: ${error instanceof Error ? error.message : String(error)}`,
        );
        session.stream.transport = "serve-sim";
        transport = transportForSession(session);
        stream = await transport.start({
          simulatorUDID,
          port: input.port ? Number(input.port) : undefined,
        });
      }
    } catch (error) {
      session.stream.state = "failed";
      session.logs.push(
        `session start failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      try {
        store.save(session);
      } catch {}
      throw error;
    }

    session.stream = publicStream(stream);
    session.logs.push(...(stream.logs || []));
    try {
      store.save(session);
    } catch (error) {
      try {
        await transport.stop(session);
      } catch {}
      closeInputChannel(session);
      throw error;
    }
    return includeCodexMetadata ? codexSession(session) : publicSession(session);
  }

  async function stopSession(sessionId) {
    const session = store.get(sessionId);
    if (!session) return;
    session.logs.push(
      `stopping ${session.stream.transport || "serve-sim"} for ${session.simulatorUDID}`,
    );
    await transportForSession(session).stop(session);
    closeInputChannel(session);
    session.stream.state = "stopped";
    session.updatedAt = new Date().toISOString();
    store.save(session);
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
    const next =
      String(current.stdout || "")
        .trim()
        .toLowerCase() === "on"
        ? "off"
        : "on";
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
    session.logs.push(
      `gesture: ${normalized.type} ${normalized.x.toFixed(3)}, ${normalized.y.toFixed(3)}`,
    );
    store.save(session);
    return { ok: true, event: normalized };
  }

  async function sendMultiTouch(session, event) {
    const normalized = normalizeMultiTouchEvent(event);
    await sendServeSimMessage(session, 5, normalized);
    session.logs.push(`multitouch: ${normalized.type}`);
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
        const encoded =
          payload === undefined
            ? new Uint8Array()
            : new TextEncoder().encode(JSON.stringify(payload));
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
          try {
            socket.close();
          } catch {}
          reject(new Error("Timed out connecting simulator controls."));
        }, 3_000);
        socket.binaryType = "arraybuffer";
        socket.onopen = () => {
          if (settled) {
            try {
              socket.close();
            } catch {}
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
      try {
        this.socket?.close();
      } catch {}
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
    if (!["begin", "move", "end"].includes(type)) {
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

  function normalizeMultiTouchEvent(event) {
    if (!event || typeof event !== "object") {
      throw new Error("Missing multi-touch event.");
    }
    const type = String(event.type || "");
    if (!["begin", "move", "end"].includes(type)) {
      throw new Error("Unsupported multi-touch type.");
    }
    const coordinates = [event.x1, event.y1, event.x2, event.y2].map(Number);
    if (!coordinates.every(Number.isFinite)) {
      throw new Error("Missing multi-touch coordinates.");
    }
    const [x1, y1, x2, y2] = coordinates.map((value) => Math.max(0, Math.min(1, value)));
    return { type, x1, y1, x2, y2 };
  }

  return Object.freeze({
    proxyStream,
    startOrReuseSession,
    stopSession,
    sendControl,
    typeIntoSimulator,
    sendNamedKey,
    tapSimulator,
    sendGesture,
    sendMultiTouch,
  });
}

function validateDependencies(dependencies) {
  const store = dependencies?.store;
  for (const method of ["findReusable", "create", "save", "get"]) {
    if (typeof store?.[method] !== "function") {
      throw new TypeError(`Session runtime controller requires store.${method}().`);
    }
  }
  if (!dependencies?.transports || typeof dependencies.transports !== "object") {
    throw new TypeError("Session runtime controller requires transports.");
  }
  if (typeof dependencies?.adapter?.ui !== "function") {
    throw new TypeError("Session runtime controller requires adapter.ui().");
  }
  if (typeof dependencies?.defaultTransportPreference !== "function") {
    throw new TypeError("Session runtime controller requires defaultTransportPreference().");
  }
}

function required(value, name) {
  if (!value || typeof value !== "string") {
    throw new Error(`Missing required ${name}.`);
  }
  return value;
}
