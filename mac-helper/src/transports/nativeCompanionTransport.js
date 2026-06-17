export class NativeCompanionTransport {
  constructor({ adapter }) {
    this.id = "native-companion";
    this.label = "Native H.264 companion transport";
    this.adapter = adapter;
  }

  async inspect() {
    const serveSim = await this.adapter.inspect();
    const available = versionAtLeast(serveSim.version, "0.1.41");
    return {
      id: this.id,
      label: this.label,
      available,
      role: "primary-phone-companion",
      quality: "native-h264",
      capture: "headless CoreSimulator framebuffer through serve-sim",
      media: "VideoToolbox H.264 AVCC",
      reason: available
        ? "serve-sim exposes the headless H.264 /stream.avcc endpoint required by the native companion."
        : `serve-sim ${serveSim.version || "unknown"} does not advertise the required AVCC transport; upgrade to 0.1.41 or newer.`,
      serveSim,
    };
  }

  async start({ simulatorUDID, port }) {
    const info = await this.inspect();
    if (!info.available) throw new Error(info.reason);
    const result = await this.adapter.start({ simulatorUDID, port });
    return {
      state: "running",
      transport: this.id,
      quality: "native-h264",
      localUrl: avccUrl(result.previewUrl),
      previewUrl: result.previewUrl,
      wsUrl: result.wsUrl,
      port: result.port,
      pid: result.pid,
      raw: result.raw,
      limitations: [],
      logs: ["native companion uses serve-sim headless H.264 AVCC stream", ...result.logs],
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

function avccUrl(previewUrl) {
  const url = new URL(previewUrl);
  url.pathname = "/stream.avcc";
  url.search = "";
  return url.toString();
}

function versionAtLeast(value, minimum) {
  const read = (input) => String(input || "")
    .match(/\d+\.\d+\.\d+/)?.[0]
    .split(".")
    .map(Number) || [];
  const current = read(value);
  const target = read(minimum);
  if (current.length !== 3 || target.length !== 3) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > target[index]) return true;
    if (current[index] < target[index]) return false;
  }
  return true;
}
