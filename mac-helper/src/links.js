export function publicSession(session) {
  const links = buildCompanionLinks(session, session.remoteBaseUrl);
  return {
    id: session.id,
    project: session.project ? "set" : "",
    scheme: session.scheme,
    simulatorUDID: session.simulatorUDID,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    build: session.build,
    stream: {
      state: session.stream.state,
      localUrl: session.stream.localUrl,
      port: session.stream.port,
      pid: session.stream.pid,
    },
    links,
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
