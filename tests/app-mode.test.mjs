import test from "node:test";
import assert from "node:assert/strict";
import { appLocalMode } from "../lib/app-mode.ts";

function withMode(mode, work) {
  const previous = process.env.NEXT_PUBLIC_APP_LOCAL_MODE;
  if (mode === undefined) delete process.env.NEXT_PUBLIC_APP_LOCAL_MODE;
  else process.env.NEXT_PUBLIC_APP_LOCAL_MODE = mode;
  try { work(); }
  finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_LOCAL_MODE;
    else process.env.NEXT_PUBLIC_APP_LOCAL_MODE = previous;
  }
}

test("local installs keep the original local workspace mode by default", () => {
  withMode(undefined, () => assert.equal(appLocalMode(), true));
  withMode("1", () => assert.equal(appLocalMode(), true));
});

test("the public server flag selects account workspace mode", () => {
  withMode("0", () => assert.equal(appLocalMode(), false));
});

test("invalid public mode is reported instead of displaying a misleading workspace", () => {
  withMode("true", () => assert.throws(() => appLocalMode(), /NEXT_PUBLIC_APP_LOCAL_MODE/));
});
