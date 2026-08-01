const FALLBACK_LIMITATIONS = [
  "Fallback stream. Use the native companion transport when available for lower latency.",
];

export function projectSessionStream(stream, transport) {
  const target = String(transport || "");
  if (target === "native-companion") {
    return {
      ...structuredClone(stream || {}),
      state: "running",
      transport: target,
      quality: "native-h264",
      localUrl: streamEndpoint(stream, "/stream.avcc"),
      previewUrl: streamEndpoint(stream, "/stream.mjpeg"),
      limitations: [],
    };
  }
  if (target === "serve-sim") {
    const previewUrl = streamEndpoint(stream, "/stream.mjpeg");
    return {
      ...structuredClone(stream || {}),
      state: "running",
      transport: target,
      quality: "fallback",
      localUrl: previewUrl,
      previewUrl,
      limitations: [...FALLBACK_LIMITATIONS],
    };
  }
  throw new Error(`Unknown session transport: ${transport}`);
}

function streamEndpoint(stream, pathname) {
  const source = String(stream?.previewUrl || stream?.localUrl || "");
  if (!source) throw new Error("The running Simulator stream has no local endpoint.");
  const url = new URL(source);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}
