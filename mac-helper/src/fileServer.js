import { closeSync, fstatSync, openSync, createReadStream } from "node:fs";

export function serveFile(res, path, { contentType, filename, notFound, admit }) {
  if (!path) return notFound(res, "Artifact is unavailable.");
  let fd;
  let stat;
  try {
    fd = openSync(path, "r");
    stat = fstatSync(fd);
  } catch {
    if (fd !== undefined) try { closeSync(fd); } catch {}
    return notFound(res, "Artifact is unavailable.");
  }

  let lease;
  try { lease = admit?.(); } catch (error) { closeSync(fd); throw error; }
  if (lease && lease.status !== 200) {
    closeSync(fd);
    res.writeHead(lease.status, { "cache-control": "no-store" });
    return res.end();
  }
  const stream = createReadStream(path, { fd, autoClose: true });
  const timer = lease && setTimeout(() => res.destroy(), Math.max(1, lease.deadline - Date.now()));
  let recorded = false;
  const finish = success => {
    if (recorded) return;
    recorded = true; clearTimeout(timer);
    try { lease?.finish(success); } catch { res.destroy(); }
  };
  res.once("finish", () => finish(true));
  let completed = false;
  stream.once("error", (error) => {
    finish(false);
    if (completed) return;
    completed = true;
    if (!res.headersSent) return notFound(res, "Artifact is unavailable.");
    res.destroy(error);
  });
  stream.once("close", () => { completed = true; });
  res.once("close", () => { stream.destroy(); finish(false); });
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": stat.size,
    "content-disposition": `attachment; filename="${String(filename || "download").replaceAll("\"", "")}"`,
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  if (lease) stream.on("data", () => { if (Date.now() >= lease.deadline) res.destroy(); });
  stream.pipe(res);
}
