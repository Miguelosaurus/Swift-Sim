import { createHash } from "node:crypto";

export function publicSession(session) {
  const links = buildCompanionLinks(session, session.remoteBaseUrl);
  return {
    id: session.id,
    recentProjectID: recentProjectID(session),
    project: session.project ? "set" : "",
    scheme: session.scheme,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    build: session.build,
    stream: {
      state: session.stream.state,
      transport: session.stream.transport || "serve-sim",
      quality: session.stream.quality || "fallback",
      limitations: session.stream.limitations || [],
    },
    links,
  };
}

function recentProjectID(session) {
  return createHash("sha256")
    .update(JSON.stringify([
      session.project || "",
      session.scheme || "",
      session.simulatorUDID || "",
    ]))
    .digest("hex");
}

export function codexSession(session) {
  return {
    ...publicSession(session),
    codex: {
      localPreviewUrl: session.stream.previewUrl || session.stream.localUrl || "",
      simulatorUDID: session.simulatorUDID || "",
      note: "Open localPreviewUrl in the Codex in-app browser before sharing the companion link. Do not expose this field to users.",
    },
  };
}

export function buildCompanionLinks(session, remoteBaseUrl = "") {
  const base = normalizeBaseUrl(remoteBaseUrl);
  const universalLink = base
    ? `${base}/s/${encodeURIComponent(session.id)}?token=${encodeURIComponent(session.token)}`
    : "";
  return {
    universalLink,
    customScheme: `swift-sim://session/${encodeURIComponent(session.id)}?token=${encodeURIComponent(session.token)}${base ? `&base=${encodeURIComponent(base)}` : ""}`,
  };
}

export function buildPairingLinks(pairing, remoteBaseUrl = "") {
  const base = normalizeBaseUrl(remoteBaseUrl);
  const name = pairing.macName ? `&name=${encodeURIComponent(pairing.macName)}` : "";
  const macID = encodeURIComponent(pairing.installationID || "");
  const invite = pairing.invite ? `invite=${encodeURIComponent(pairing.invite)}` : `token=${encodeURIComponent(pairing.token || "")}`;
  const expiry = pairing.expiresAt ? `&expiresAt=${encodeURIComponent(pairing.expiresAt)}` : "";
  const universalLink = base
    ? `${base}/pair?${invite}&macID=${macID}&base=${encodeURIComponent(base)}${expiry}`
    : "";
  return {
    universalLink,
    customScheme: `swift-sim://pair?${invite}&macID=${macID}${base ? `&base=${encodeURIComponent(base)}` : ""}${name}${expiry}`,
  };
}

function normalizeBaseUrl(value) {
  if (!value) return "";
  return String(value).replace(/\/+$/, "");
}
