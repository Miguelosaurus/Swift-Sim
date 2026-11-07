#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join, resolve } from 'node:path';
const root = resolve(process.argv[2]); assert(!existsSync(root)); mkdirSync(root, { recursive: true, mode: 0o700 });
const sockets = [], received = [];
const upstream = net.createServer(socket => { sockets.push(socket); socket.on('data', chunk => received.push(chunk)); });
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const child = spawn(process.execPath, [resolve('scripts/experimental/hot-reload/full-callable/receipt-loss-proxy.mjs'), root, String(port), String(upstream.address().port)], { stdio: ['ignore', 'pipe', 'pipe'] });
const deadline = setTimeout(() => { child.kill('SIGTERM'); throw new Error('proxy test timeout'); }, 10000);
function frame(report) { const body = Buffer.from(JSON.stringify(report)), prefix = Buffer.alloc(8); prefix.writeInt32LE(12); prefix.writeInt32LE(body.length, 4); return Buffer.concat([prefix, body]); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect() { const socket = net.connect({ host: '127.0.0.1', port }); socket.on('error', () => {}); sockets.push(socket); await once(socket, 'connect'); socket.setNoDelay(true); return socket; }
async function fragmented(socket, bytes) { for (let i = 0; i < bytes.length && !socket.destroyed; i += 3) { socket.write(bytes.subarray(i, i + 3)); await new Promise(setImmediate); } }
try {
  await once(child.stdout, 'data');
  const id = randomUUID(); writeFileSync(join(root, 'target.json'), JSON.stringify({ requestId: id }), { mode: 0o600 });
  const success = { request_id: id, succeeded: true, applied: true, refresh_acknowledged: true, replacement_proof_version: 3, root_revision: 2 };
  const other = frame({ ...success, request_id: randomUUID() }), rejected = frame({ ...success, applied: false });
  const first = await connect(); await fragmented(first, Buffer.concat([other, rejected]));
  for (let i = 0; i < 100 && Buffer.concat(received).length < other.length + rejected.length; i++) await wait(10);
  assert.deepEqual(Buffer.concat(received), Buffer.concat([other, rejected]));
  const closed = once(first, 'close'); await fragmented(first, frame(success)); await closed;
  assert.deepEqual(Buffer.concat(received), Buffer.concat([other, rejected]));
  assert.equal(JSON.parse(readFileSync(join(root, 'dropped-report.json'))).report.request_id, id);
  const next = await connect(); await fragmented(next, frame(success));
  for (let i = 0; i < 100 && Buffer.concat(received).length < other.length + rejected.length + frame(success).length; i++) await wait(10);
  assert.deepEqual(Buffer.concat(received), Buffer.concat([other, rejected, frame(success)]));
  const events = readFileSync(join(root, 'proxy-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(event => event.kind === 'dropped-successful-receipt').length, 1);
  writeFileSync(join(root, 'receipt.json'), JSON.stringify({ passed: true, fragmentedFrames: true, unrelatedAndFailedFramesUntouched: true, drops: 1, reconnectForwardsSameReceipt: true, pid: child.pid }, null, 2), { mode: 0o600 });
  console.log('RECEIPT_PROXY_PASS fragmented=true unrelated=untouched failed=untouched drops=1 reconnect=forwarded');
} finally {
  clearTimeout(deadline); const stopped = once(child, 'exit'); child.kill('SIGTERM');
  for (const socket of sockets) socket.destroy(); await stopped; await new Promise(resolve => upstream.close(resolve));
}
