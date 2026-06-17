export class ServeSimTransport {
  constructor({ adapter }) {
    this.id = "serve-sim";
    this.label = "serve-sim fallback";
    this.adapter = adapter;
  }

  async inspect() {
    const info = await this.adapter.inspect();
    return {
      id: this.id,
      label: this.label,
      available: true,
      role: "codex-preview-and-fallback",
      quality: "fallback",
      limitations: [
        "MJPEG-style frame delivery can be slow on cellular.",
        "Gesture fidelity depends on the installed serve-sim command.",
        "Multi-touch and pinch are not guaranteed.",
      ],
      serveSim: info,
    };
  }

  async start({ simulatorUDID, port }) {
    const result = await this.adapter.start({ simulatorUDID, port });
    return {
      state: "running",
      transport: this.id,
      quality: "fallback",
      localUrl: result.previewUrl,
      wsUrl: result.wsUrl,
      port: result.port,
      pid: result.pid,
      raw: result.raw,
      limitations: [
        "Fallback stream. Use the native companion transport when available for lower latency.",
      ],
      logs: result.logs,
    };
  }

  async restart(session) {
    await this.adapter.kill(session.simulatorUDID);
    return this.start({
      simulatorUDID: session.simulatorUDID,
      port: session.stream.port,
    });
  }

  async stop(session) {
    await this.adapter.kill(session.simulatorUDID);
  }
}
