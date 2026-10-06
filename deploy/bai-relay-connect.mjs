#!/usr/bin/env node
// CONNECT framing only: TLS, certificate checks and API credentials stay in the app.
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LOOPBACK = '127.0.0.1';
const DESTINATION = 'api.b.ai:443';
const replies = {
  400: 'Bad Request', 403: 'Forbidden', 405: 'Method Not Allowed',
  502: 'Bad Gateway', 504: 'Gateway Timeout',
};

function reject(socket, status) {
  if (!socket.destroyed && socket.writable) {
    socket.end(`HTTP/1.1 ${status} ${replies[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } else socket.destroy();
}

// Port/time overrides allow isolated loopback tests; the CLI uses fixed defaults.
export async function startBaiRelay({
  port = 13128, upstreamPort = 18443, maxConnections = 16,
  headersTimeoutMs = 10_000, connectTimeoutMs = 10_000, idleTimeoutMs = 600_000,
} = {}) {
  for (const [name, value, minimum, maximum] of [
    ['port', port, 0, 65535], ['upstreamPort', upstreamPort, 1, 65535],
    ['maxConnections', maxConnections, 1, 128],
    ['headersTimeoutMs', headersTimeoutMs, 1, 60_000],
    ['connectTimeoutMs', connectTimeoutMs, 1, 60_000],
    ['idleTimeoutMs', idleTimeoutMs, 1, 3_600_000],
  ]) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`Invalid relay option: ${name}`);
    }
  }
  const clients = new Set();
  const upstreams = new Set();
  const denyHttp = (_request, response) => {
    response.writeHead(405, { Connection: 'close', 'Content-Length': '0' });
    response.end();
  };
  const server = createServer({
    maxHeaderSize: 8192,
    headersTimeout: headersTimeoutMs,
    requestTimeout: headersTimeoutMs,
    connectionsCheckingInterval: Math.min(headersTimeoutMs, 1000),
  }, denyHttp);
  server.maxConnections = maxConnections;
  server.maxHeadersCount = 32;
  server.on('checkContinue', denyHttp);
  server.on('checkExpectation', denyHttp);
  server.on('clientError', (_error, socket) => reject(socket, 400));
  server.on('upgrade', (_request, socket) => reject(socket, 400));
  server.on('connection', socket => {
    clients.add(socket);
    socket.setTimeout(headersTimeoutMs, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.once('close', () => clients.delete(socket));
  });
  server.on('connect', (request, client, head) => {
    if (request.url !== DESTINATION) {
      reject(client, 403);
      return;
    }
    client.pause();
    client.setTimeout(idleTimeoutMs);
    client.setNoDelay(true);
    const upstream = connect({ host: LOOPBACK, port: upstreamPort });
    upstreams.add(upstream);
    let established = false;
    const fail = status => {
      clearTimeout(timer);
      upstream.destroy();
      if (established) client.destroy();
      else reject(client, status);
    };
    const timer = setTimeout(() => fail(504), connectTimeoutMs);
    timer.unref();
    upstream.setNoDelay(true);
    upstream.setTimeout(idleTimeoutMs, () => { client.destroy(); upstream.destroy(); });
    upstream.on('error', () => fail(502));
    upstream.once('close', () => {
      clearTimeout(timer);
      upstreams.delete(upstream);
      // Let a buffered reply finish before closing the client write side.
      if (established && !client.destroyed) client.end();
    });
    client.once('close', () => { clearTimeout(timer); upstream.destroy(); });
    upstream.once('connect', () => {
      clearTimeout(timer);
      if (client.destroyed) { upstream.destroy(); return; }
      established = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      // Preserve any first TLS bytes parsed alongside the CONNECT headers.
      if (head.length) upstream.write(head);
      // pipe() preserves byte order and backpressure in both directions.
      upstream.pipe(client);
      client.pipe(upstream);
    });
  });
  await new Promise((resolve, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: LOOPBACK, port }, () => {
      server.off('error', rejectListen);
      resolve();
    });
  });
  return {
    server,
    close: () => new Promise((resolve, rejectClose) => {
      for (const socket of clients) socket.destroy();
      for (const socket of upstreams) socket.destroy();
      server.close(error => error ? rejectClose(error) : resolve());
    }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startBaiRelay().then(relay => {
    console.log('B.AI CONNECT relay listening on 127.0.0.1:13128.');
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void relay.close().then(() => process.exit(0), () => process.exit(1));
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }).catch(() => {
    console.error('B.AI CONNECT relay could not start.');
    process.exitCode = 1;
  });
}
