import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthConfigurationError } from "../lib/auth-core.ts";
import { getLocalModeUser } from "../lib/local-mode.ts";

const environment = { APP_LOCAL_MODE: "1", APP_URL: "http://127.0.0.1:3000" };

test("local mode uses a stable identity only for the configured loopback Host", () => {
  const user = getLocalModeUser(new Headers({ host: "127.0.0.1:3000" }), environment);
  assert.deepEqual(user, { id: "local-user", email: "local@localhost", displayName: "本机用户" });
  assert.deepEqual(getLocalModeUser(new Headers({ host: "127.0.0.1:3000", cookie: "unrelated=abc" }), environment), user);
  for (const url of ["http://localhost:4321", "http://[::1]:3000", "https://127.0.0.1"]) {
    assert.equal(getLocalModeUser(new Headers({ host: new URL(url).host }), { ...environment, APP_URL: url }).id, user.id);
  }
});

test("missing, foreign, malformed and alternate loopback Hosts are denied", () => {
  for (const host of [null, "example.com:3000", "localhost:3000", "127.0.0.1", "127.0.0.1:3001", "[::1]:3000", "127.0.0.1:3000.evil.example", "127.0.0.1:3000, evil.example", "user@127.0.0.1:3000"]) {
    const headers = new Headers(host === null ? {} : { host });
    assert.equal(getLocalModeUser(headers, environment), null, `Host ${host} must be denied`);
  }
});

test("forwarded headers cannot replace the actual Host", () => {
  for (const host of [undefined, "rebound.example:3000"]) {
    const headers = new Headers({ "x-forwarded-host": "127.0.0.1:3000", "forwarded": "host=127.0.0.1:3000" });
    if (host) headers.set("host", host);
    assert.equal(getLocalModeUser(headers, environment), null);
  }
});

test("local mode requires an explicit loopback configuration", () => {
  for (const APP_URL of [undefined, "", "https://studio.example.com", "http://0.0.0.0:3000", "http://192.168.1.10:3000", "https://localhost.evil.example", "http://127.0.0.1:3000/path"]) {
    assert.throws(() => getLocalModeUser(new Headers({ host: "127.0.0.1:3000" }), { APP_LOCAL_MODE: "1", APP_URL }), AuthConfigurationError);
  }
});

test("local identity is disabled unless APP_LOCAL_MODE is exactly 1", () => {
  for (const APP_LOCAL_MODE of [undefined, "", "0", "true", "yes", " 1 "]) {
    assert.equal(getLocalModeUser(new Headers({ host: "127.0.0.1:3000" }), { APP_LOCAL_MODE }), null);
  }
});
