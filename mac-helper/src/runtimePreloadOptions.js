export function appendNodeImport(nodeOptions, moduleURL) {
  const current = String(nodeOptions || "").trim();
  const target = String(moduleURL || "").trim();
  if (!target) return current;
  const flag = `--import=${target}`;
  if (current.split(/\s+/).includes(flag)) return current;
  return [current, flag].filter(Boolean).join(" ");
}
