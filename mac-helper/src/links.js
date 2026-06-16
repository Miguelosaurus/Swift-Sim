export function publicSession(session) {
  const links = buildCompanionLinks(session, session.remoteBaseUrl);
  return {
    id: session.id,
    project: session.project ? "set" : "",
    scheme: session.scheme,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    build: session.build,
    stream: {
      state: session.stream.state,
    },
    links,
  };
}

export function codexSession(session) {
  return {
    ...publicSession(session),
    codex: {
      localPreviewUrl: session.stream.localUrl || "",
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
  const universalLink = base
    ? `${base}/pair?token=${encodeURIComponent(pairing.token)}`
    : "";
  return {
    universalLink,
    customScheme: `swift-sim://pair?token=${encodeURIComponent(pairing.token)}${base ? `&base=${encodeURIComponent(base)}` : ""}`,
  };
}

function normalizeBaseUrl(value) {
  if (!value) return "";
  return String(value).replace(/\/+$/, "");
}
