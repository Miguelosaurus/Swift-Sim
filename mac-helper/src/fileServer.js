import { closeSync, fstatSync, openSync, createReadStream } from "node:fs";

export function serveFile(res, path, { contentType, filename, notFound }) {
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

  const stream = createReadStream(path, { fd, autoClose: true });
  let completed = false;
  stream.once("error", (error) => {
    if (completed) return;
    completed = true;
    if (!res.headersSent) return notFound(res, "Artifact is unavailable.");
    res.destroy(error);
  });
  stream.once("close", () => { completed = true; });
  res.once("close", () => stream.destroy());
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": stat.size,
    "content-disposition": `attachment; filename="${String(filename || "download").replaceAll("\"", "")}"`,
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  stream.pipe(res);
}
