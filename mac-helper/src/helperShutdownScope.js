export function helperRunsAsService(argv = process.argv) {
  return String(argv?.[2] || "") === "serve";
}
