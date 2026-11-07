#!/usr/bin/env node
// Task-owned loopback-only TCP fault fixture. Never used by normal Swift Sim.
// Arguments: private evidence directory, listening port, upstream engine port.
import assert from 'node:assert/strict';
import net from 'node:net';
import { appendFileSync, existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(process.argv[2]), listen = Number(process.argv[3]), upstreamPort = Number(process.argv[4]);
assert(lstatSync(root).isDirectory() && (lstatSync(root).mode & 0o077) === 0);
assert([listen, upstreamPort].every(port => Number.isInteger(port) && port > 1024 && port < 65536));
assert.notEqual(listen, upstreamPort);
const marker = Buffer.from([12, 0, 0, 0]); // InjectionResponse.patchResult, one framed JSON string
const peers = new Set(); let connections = 0, dropped = existsSync(join(root, 'dropped-report.json'));
function event(kind, data = {}) { appendFileSync(join(root, 'proxy-events.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind, ...data }) + '\n', { mode: 0o600 }); }
function target() {
  try { const value = JSON.parse(readFileSync(join(root, 'target.json'), 'utf8')); return /^[a-f0-9-]{36}$/i.test(value.requestId) ? value.requestId : ''; }
  catch { return ''; }
}
const server = net.createServer(client => {
  const id = ++connections, upstream = net.connect({ host: '127.0.0.1', port: upstreamPort });
  peers.add(client); peers.add(upstream); let held = Buffer.alloc(0);
  event('connected', { connection: id });
  function forward(data) { if (data.length && !upstream.write(data)) client.pause(); }
  upstream.on('drain', () => client.resume());
  upstream.pipe(client);
  client.on('data', chunk => {
    const requestId = target();
    if (dropped || !requestId) { if (held.length) { forward(held); held = Buffer.alloc(0); } forward(chunk); return; }
    held = Buffer.concat([held, chunk]);
    while (held.length) {
      const at = held.indexOf(marker);
      if (at < 0) {
        let suffix = 0;
        for (let count = 1; count < marker.length && count <= held.length; count++) {
          if (held.subarray(held.length - count).equals(marker.subarray(0, count))) suffix = count;
        }
        forward(held.subarray(0, held.length - suffix)); held = held.subarray(held.length - suffix); return;
      }
      if (at) { forward(held.subarray(0, at)); held = held.subarray(at); }
      if (held.length < 8) return;
      const length = held.readInt32LE(4);
      if (length <= 0 || length > 65536) { forward(held.subarray(0, 1)); held = held.subarray(1); continue; }
      if (held.length < 8 + length) return;
      const frame = held.subarray(0, 8 + length); let report;
      try { report = JSON.parse(frame.subarray(8).toString('utf8')); } catch {}
      if (report?.request_id === requestId && report.succeeded === true && report.applied === true
        && report.refresh_acknowledged === true && report.replacement_proof_version === 3) {
        dropped = true;
        writeFileSync(join(root, 'dropped-report.json'), JSON.stringify({ at: new Date().toISOString(), connection: id, report }, null, 2), { mode: 0o600 });
        event('dropped-successful-receipt', { connection: id, requestId, revision: report.root_revision });
        held = Buffer.alloc(0); client.destroy(); upstream.destroy(); return;
      }
      forward(frame); held = held.subarray(frame.length);
    }
  });
  client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
  client.on('close', () => { peers.delete(client); upstream.destroy(); event('closed', { connection: id }); });
  upstream.on('close', () => { peers.delete(upstream); client.destroy(); });
});
server.on('error', error => { event('error', { code: error.code }); process.exitCode = 1; });
server.listen(listen, '127.0.0.1', () => { event('ready', { pid: process.pid, listen, upstreamPort }); console.log(JSON.stringify({ ready: true, pid: process.pid, listen, upstreamPort })); });
function stop() { for (const peer of peers) peer.destroy(); server.close(() => { event('stopped', { connections, dropped }); process.exit(0); }); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
