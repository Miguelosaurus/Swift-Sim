export function appendNodeImport(nodeOptions, moduleURL) {
  const current = String(nodeOptions || "").trim();
  const target = String(moduleURL || "").trim();
  if (!target) return current;
  const flag = `--import=${target}`;
  if (nodeOptionTokens(current).includes(flag)) return current;
  return [current, flag].filter(Boolean).join(" ");
}

export function replaceSwiftSimNodeImport(nodeOptions, moduleURL) {
  const retained = nodeOptionTokens(nodeOptions)
    .filter((token) => !isSwiftSimRuntimeImport(token));
  return appendNodeImport(retained.join(" "), moduleURL);
}

function nodeOptionTokens(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean);
}

function isSwiftSimRuntimeImport(token) {
  if (!String(token).startsWith("--import=")) return false;
  try {
    const url = new URL(String(token).slice("--import=".length));
    return /\/mac-helper\/src\/hardenedRuntimePreload\.js$/.test(url.pathname);
  } catch {
    return false;
  }
}
