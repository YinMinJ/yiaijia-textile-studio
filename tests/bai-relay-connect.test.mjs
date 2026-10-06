import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { startBaiRelay } from "../deploy/bai-relay-connect.mjs";

const TEST_TIMEOUT_MS = 5_000;
const CONNECT = "CONNECT api.b.ai:443 HTTP/1.1\r\nHost: api.b.ai:443\r\n\r\n";

function observe(socket) {
  const chunks = [];
  const waiting = new Set();
  let error;
  let ended = false;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  const bytes = () => Buffer.concat(chunks);
  const notify = () => {
    for (const check of [...waiting]) check();
  };
  socket.on("data", (chunk) => {
    chunks.push(chunk);
    notify();
  });
  socket.on("error", (cause) => {
    error = cause;
    notify();
  });
  socket.on("close", () => {
    ended = true;
    resolveClosed();
    notify();
  });
  return {
    socket,
    bytes,
    closed,
    waitFor(predicate) {
      return new Promise((resolve, reject) => {
        const finish = (cause, value) => {
          clearTimeout(timer);
          waiting.delete(check);
          if (cause) reject(cause);
          else resolve(value);
        };
        const check = () => {
          const value = bytes();
          if (predicate(value)) finish(undefined, value);
          else if (error || ended) finish(error || new Error("Socket closed before expected bytes arrived"));
        };
        const timer = setTimeout(() => finish(new Error("Timed out waiting for socket bytes")), 2_000);
        waiting.add(check);
        check();
      });
    },
  };
}

async function fixture(t, options = {}) {
  const upstreamConnections = [];
  const clients = [];
  let relay;
  let nextConnection;
  const upstream = net.createServer((socket) => {
    const connection = observe(socket);
    upstreamConnections.push(connection);
    nextConnection?.(connection);
    nextConnection = undefined;
  });
  t.after(async () => {
    for (const client of clients) client.socket.destroy();
    for (const connection of upstreamConnections) connection.socket.destroy();
    if (relay) await relay.close();
    if (upstream.listening) await new Promise((resolve) => upstream.close(resolve));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = upstream.address().port;
  relay = await startBaiRelay({ port: 0, upstreamPort, ...options });
  return {
    relay,
    upstream,
    upstreamConnections,
    nextUpstream() {
      return new Promise((resolve) => { nextConnection = resolve; });
    },
    async connect() {
      const client = observe(net.connect({ host: "127.0.0.1", port: relay.server.address().port }));
      clients.push(client);
      await once(client.socket, "connect");
      return client;
    },
  };
}

async function responseHeaders(client) {
  const bytes = await client.waitFor((value) => value.includes("\r\n\r\n"));
  return bytes.subarray(0, bytes.indexOf("\r\n\r\n") + 4).toString("latin1");
}

test("relay binds only IPv4 loopback and forwards binary CONNECT data in both directions, including head bytes", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const setup = await fixture(t);
  assert.equal(setup.relay.server.address().address, "127.0.0.1");
  const upstreamConnected = setup.nextUpstream();
  const client = await setup.connect();
  const head = Buffer.from([0x16, 0x03, 0x01, 0x00, 0x05, 0xff, 0x00, 0x80, 0x0d, 0x0a]);
  client.socket.write(Buffer.concat([Buffer.from(CONNECT), head]));
  const upstream = await upstreamConnected;
  const headers = await responseHeaders(client);
  assert.match(headers, /^HTTP\/1\.1 200\b/);
  assert.deepEqual(await upstream.waitFor((value) => value.length >= head.length), head);

  const answer = Buffer.from([0x16, 0x03, 0x03, 0x00, 0xff, 0x80]);
  upstream.socket.write(answer);
  let response = await client.waitFor((value) => value.length >= Buffer.byteLength(headers) + answer.length);
  assert.deepEqual(response.subarray(Buffer.byteLength(headers)), answer);

  const later = Buffer.from("later tunnel payload\0\xff", "latin1");
  client.socket.write(later);
  assert.deepEqual(await upstream.waitFor((value) => value.length >= head.length + later.length), Buffer.concat([head, later]));
  const final = Buffer.from("second upstream payload\0", "latin1");
  upstream.socket.write(final);
  response = await client.waitFor((value) => value.length >= Buffer.byteLength(headers) + answer.length + final.length);
  assert.deepEqual(response.subarray(Buffer.byteLength(headers)), Buffer.concat([answer, final]));
});

test("CONNECT rejects every non-exact destination before opening an upstream connection", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const setup = await fixture(t);
  for (const target of [
    "example.com:443",
    "api.b.ai:80",
    "API.B.AI:443",
    "api.b.ai.:443",
    "api.b.ai:443/",
    "api.b.ai:443@other.example:443",
    "127.0.0.1:443",
    "[::1]:443",
  ]) {
    const client = await setup.connect();
    client.socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: api.b.ai:443\r\n\r\n`);
    assert.match(await responseHeaders(client), /^HTTP\/1\.1 403\b/, target);
    await client.closed;
  }
  assert.equal(setup.upstreamConnections.length, 0);
});

test("ordinary HTTP requests return 405 without opening an upstream connection", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const setup = await fixture(t);
  for (const request of [
    "GET / HTTP/1.1\r\nHost: api.b.ai\r\nConnection: close\r\n\r\n",
    "POST http://api.b.ai/v1/images/edits HTTP/1.1\r\nHost: api.b.ai\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest",
  ]) {
    const client = await setup.connect();
    client.socket.write(request);
    assert.match(await responseHeaders(client), /^HTTP\/1\.1 405\b/);
    await client.closed;
  }
  assert.equal(setup.upstreamConnections.length, 0);
});

test("a refused local upstream returns 502 instead of confirming a tunnel", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const setup = await fixture(t);
  await new Promise((resolve) => setup.upstream.close(resolve));
  const client = await setup.connect();
  client.socket.write(CONNECT);
  assert.match(await responseHeaders(client), /^HTTP\/1\.1 502\b/);
  await client.closed;
  assert.equal(setup.upstreamConnections.length, 0);
});

test("disconnecting the client closes its upstream socket", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const setup = await fixture(t);
  const upstreamConnected = setup.nextUpstream();
  const client = await setup.connect();
  client.socket.write(CONNECT);
  const upstream = await upstreamConnected;
  assert.match(await responseHeaders(client), /^HTTP\/1\.1 200\b/);
  client.socket.destroy();
  await upstream.closed;
  assert.equal(upstream.socket.destroyed, true);
});

test("disconnecting upstream closes the client tunnel", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const setup = await fixture(t);
  const upstreamConnected = setup.nextUpstream();
  const client = await setup.connect();
  client.socket.write(CONNECT);
  const upstream = await upstreamConnected;
  assert.match(await responseHeaders(client), /^HTTP\/1\.1 200\b/);
  upstream.socket.destroy();
  await client.closed;
  assert.equal(client.socket.destroyed, true);
});

test("a client half-close forwards its last bytes and preserves the final upstream reply", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const setup = await fixture(t);
  const upstreamConnected = setup.nextUpstream();
  const client = await setup.connect();
  client.socket.write(CONNECT);
  const upstream = await upstreamConnected;
  const headers = await responseHeaders(client);
  assert.match(headers, /^HTTP\/1\.1 200\b/);
  const finalRequest = Buffer.from("final request bytes\0");
  const finalReply = Buffer.from("reply after client FIN\0");
  upstream.socket.once("end", () => upstream.socket.end(finalReply));
  client.socket.end(finalRequest);
  assert.deepEqual(await upstream.waitFor((value) => value.length >= finalRequest.length), finalRequest);
  const response = await client.waitFor((value) => value.length >= Buffer.byteLength(headers) + finalReply.length);
  assert.deepEqual(response.subarray(Buffer.byteLength(headers)), finalReply);
  await Promise.all([client.closed, upstream.closed]);
});

test("connection capacity drops excess TCP clients and recovers after a tunnel closes", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const setup = await fixture(t, { maxConnections: 1 });
  let upstreamConnected = setup.nextUpstream();
  const first = await setup.connect();
  first.socket.write(CONNECT);
  const firstUpstream = await upstreamConnected;
  assert.match(await responseHeaders(first), /^HTTP\/1\.1 200\b/);

  const excess = await setup.connect();
  excess.socket.write(CONNECT);
  await excess.closed;
  assert.equal(excess.bytes().length, 0);
  assert.equal(setup.upstreamConnections.length, 1);
  first.socket.destroy();
  await firstUpstream.closed;
  // The peer can observe FIN before Node releases the relay's connection slot.
  let active = 1;
  for (let attempt = 0; attempt < 100 && active > 0; attempt++) {
    active = await new Promise((resolve, reject) => {
      setup.relay.server.getConnections((error, count) => error ? reject(error) : resolve(count));
    });
    if (active > 0) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(active, 0, "the disconnected tunnel must release its connection slot");

  upstreamConnected = setup.nextUpstream();
  const replacement = await setup.connect();
  replacement.socket.write(CONNECT);
  await upstreamConnected;
  assert.match(await responseHeaders(replacement), /^HTTP\/1\.1 200\b/);
  assert.equal(setup.upstreamConnections.length, 2);
});

test("incomplete headers expire without opening an upstream connection", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const setup = await fixture(t, { headersTimeoutMs: 100 });
  const client = await setup.connect();
  client.socket.write("CONNECT api.b.ai:443 HTTP/1.1\r\nHost: api.b.ai:");
  await client.closed;
  assert.equal(setup.upstreamConnections.length, 0);
});

test("an idle tunnel closes both client and upstream sockets", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const setup = await fixture(t, { idleTimeoutMs: 100 });
  const upstreamConnected = setup.nextUpstream();
  const client = await setup.connect();
  client.socket.write(CONNECT);
  const upstream = await upstreamConnected;
  assert.match(await responseHeaders(client), /^HTTP\/1\.1 200\b/);
  await Promise.all([client.closed, upstream.closed]);
});
