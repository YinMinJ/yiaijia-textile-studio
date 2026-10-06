import test from "node:test";
import assert from "node:assert/strict";
import { appBasePath, appPath } from "../lib/app-path.ts";

function withBasePath(value, work) {
  const previous = process.env.NEXT_PUBLIC_APP_BASE_PATH;
  if (value === undefined) delete process.env.NEXT_PUBLIC_APP_BASE_PATH;
  else process.env.NEXT_PUBLIC_APP_BASE_PATH = value;
  try { work(); }
  finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_BASE_PATH;
    else process.env.NEXT_PUBLIC_APP_BASE_PATH = previous;
  }
}

test("root deployment preserves existing API, sample and download URLs", () => {
  for (const prefix of [undefined, "", "/"]) withBasePath(prefix, () => {
    assert.equal(appBasePath(), "");
    for (const url of ["/", "/api/projects", "/api/assets/photo-id", "/samples/00224.jpg", "blob:https://example.com/file"]) {
      assert.equal(appPath(url), url);
    }
  });
});

test("subpath deployment prefixes canonical resource URLs without mutating them", () => {
  withBasePath("/zhijing", () => {
    const storedAsset = { url: "/api/assets/photo-id" };
    assert.equal(appBasePath(), "/zhijing");
    assert.equal(appPath("/"), "/zhijing/");
    assert.equal(appPath("/api/projects"), "/zhijing/api/projects");
    assert.equal(appPath(storedAsset.url), "/zhijing/api/assets/photo-id");
    assert.equal(storedAsset.url, "/api/assets/photo-id");
    assert.equal(appPath("/samples/00224.jpg?size=2#photo"), "/zhijing/samples/00224.jpg?size=2#photo");
  });
});

test("subpath links remain stable when resolved more than once", () => {
  withBasePath("/zhijing", () => {
    for (const url of ["/zhijing", "/zhijing/", "/zhijing/api/assets/photo-id", "/zhijing?view=main", "/zhijing#help"]) {
      assert.equal(appPath(url), url);
    }
    assert.equal(appPath("/zhijing-other"), "/zhijing/zhijing-other");
  });
});

test("external, embedded, relative and anchor URLs are unchanged", () => {
  withBasePath("/zhijing", () => {
    for (const url of ["https://detail.vip.com/item.html", "//cdn.example.com/image.jpg", "data:image/png;base64,AAA", "blob:https://jxcymj.asia/photo", "images/product.jpg", "#help", ""]) {
      assert.equal(appPath(url), url);
    }
  });
});

test("deployment prefixes normalize surrounding whitespace and trailing slashes", () => {
  withBasePath(" /zhijing/ ", () => assert.equal(appPath("/fonts/font.woff2"), "/zhijing/fonts/font.woff2"));
  withBasePath("tools/zhijing/", () => assert.equal(appPath("/api/projects"), "/tools/zhijing/api/projects"));
});

test("deployment prefixes reject query strings and external addresses", () => {
  for (const value of ["https://example.com", "/zhijing?view=main", "/zhijing#help", "/../zhijing"]) {
    withBasePath(value, () => assert.throws(() => appBasePath(), /NEXT_PUBLIC_APP_BASE_PATH/));
  }
});
