import { platform, release } from "node:os";

export class NativeCompanionTransport {
  constructor() {
    this.id = "native-companion";
    this.label = "Native companion transport";
  }

  async inspect() {
    return {
      id: this.id,
      label: this.label,
      available: false,
      role: "primary-phone-companion",
      quality: "target",
      platform: platform(),
      osRelease: release(),
      requirements: [
        "Mac-side ScreenCaptureKit window capture for the tracked Simulator.",
        "VideoToolbox H.264 or HEVC encoding.",
        "Low-latency media transport, preferably WebRTC.",
        "Persistent control channel for touch, drag, keyboard, hardware buttons, and rotation.",
      ],
      reason: "The native low-latency transport is not implemented in this checkout yet. serve-sim remains the fallback transport.",
    };
  }

  async start() {
    const info = await this.inspect();
    throw new Error(info.reason);
  }

  async restart() {
    return this.start();
  }

  async stop() {
    return;
  }
}
