#!/usr/bin/env node
// Build on Linux, then ship only the traced service and explicit public inputs.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  chmod, copyFile, lstat, mkdir, mkdtemp, open, readdir, readFile,
  readlink, realpath, rm, symlink, writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requiredNodeVersion = "24.19.0";
const requiredPnpmVersion = "pnpm@11.25.0";
const requiredBasePath = "/zhijing";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sourceFiles = [
  "package.json",
  "scripts/start-server.mjs",
  "scripts/create-user.mjs",
  "scripts/import-model-settings.mjs",
  "scripts/verify-http.mjs",
  "lib/auth-core.ts",
  "lib/database.ts",
  "lib/app-path.ts",
  "lib/server-secrets.ts",
  "lib/model-connection.ts",
  "deploy/zhijing.service",
  "deploy/zhijing.env.example",
  "deploy/nginx-location.conf",
];

// Public samples and licensed fonts are deliberately named. New public assets
// must be reviewed here; an arbitrary upload under public is never published.
const publicFiles = [
  "favicon.svg", "file.svg", "globe.svg", "window.svg",
  "fonts/ResourceHanRoundedCN-Regular.woff2",
  "fonts/ResourceHanRoundedCN-Medium.woff2",
  "fonts/ResourceHanRoundedCN-Bold.woff2",
  "fonts/ResourceHanRounded-LICENSE.txt",
  "fonts/ResourceHanRounded-NOTICE.txt",
  ...["00224", "00225", "00229", "00233", "00237", "00240", "00246", "00265-edge"].map(name => `samples/${name}.jpg`),
];

function fail(message) { throw new Error(message); }
function isWithin(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

/** Reject persistent/private files even if output tracing included them. */
export function assertSafeReleasePath(relative) {
  if (!relative || relative.includes("\\") || /^[A-Za-z]:/.test(relative) || path.posix.isAbsolute(relative) || /[\x00-\x1f\x7f]/.test(relative)) fail("Unsafe release path.");
  const parts = relative.split("/");
  if (parts.some(part => !part || part === "." || part === "..")) fail("Unsafe release path.");
  for (const part of parts) {
    if (
      /^\.env/i.test(part) || /^\.encryption-secret/i.test(part) ||
      [".git", ".ssh", ".aws", ".npmrc", "encryption-secret"].includes(part.toLowerCase()) ||
      /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i.test(part) ||
      /\.(?:sqlite3?(?:-.*)?|db(?:-.*)?|pem|key|p12|pfx|keystore|log)$/i.test(part)
    ) fail("Private data or credentials must not appear in a server release.");
  }
  const appPath = relative.replace(/^\.next\/standalone\//, "");
  if (/^(?:data|uploads|accounts|outputs|work)(?:\/|$)/i.test(appPath)) fail("Persistent application data must not appear in a server release.");
}

function assertLinuxBinary(bytes, relative) {
  // ELF64, little-endian, EM_X86_64. Never ship Windows/macOS native addons.
  if (bytes.length < 20 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 62) {
    fail(`A native runtime file is not Linux x64: ${relative}`);
  }
}

/** Copy without dereferencing links; every link must stay inside this tree. */
export async function copyReleaseTree(sourceRoot, destinationRoot, { skip = () => false } = {}) {
  const canonicalSource = await realpath(sourceRoot);
  const topLevel = await lstat(sourceRoot);
  if (!topLevel.isDirectory() || topLevel.isSymbolicLink()) fail("Release input must be a real directory.");
  let nativeAddonCount = 0;
  async function copy(relative) {
    if (relative && skip(relative)) return;
    if (relative) assertSafeReleasePath(relative);
    const source = path.join(sourceRoot, relative);
    const destination = path.join(destinationRoot, relative);
    const stat = await lstat(source);
    if (stat.isSymbolicLink()) {
      const target = await readlink(source);
      if (path.isAbsolute(target) || /^[A-Za-z]:/.test(target) || target.includes("\\")) fail("Absolute or foreign-platform symlinks are not portable.");
      const resolved = path.resolve(path.dirname(source), target);
      if (!isWithin(canonicalSource, resolved) || !isWithin(canonicalSource, await realpath(source))) fail("A release symlink escapes its input tree.");
      const targetRelative = path.relative(canonicalSource, resolved).split(path.sep).join("/");
      assertSafeReleasePath(targetRelative);
      if (skip(targetRelative)) fail("A release symlink points to an excluded file.");
      await symlink(target, destination);
      return;
    }
    if (stat.isDirectory()) {
      await mkdir(destination, { recursive: true, mode: 0o755 });
      for (const name of (await readdir(source)).sort()) await copy(relative ? `${relative}/${name}` : name);
      return;
    }
    if (!stat.isFile()) fail("Special filesystem entries are not permitted in a release.");
    if (/\.(?:dll|dylib|exe)$/i.test(relative)) fail("A foreign-platform native runtime file was traced.");
    if (/\.node$|\.so(?:\.|$)/i.test(relative)) {
      const handle = await open(source, "r");
      try {
        const bytes = Buffer.alloc(20);
        const result = await handle.read(bytes, 0, bytes.length, 0);
        assertLinuxBinary(bytes.subarray(0, result.bytesRead), relative);
      } finally { await handle.close(); }
      if (relative.endsWith(".node")) nativeAddonCount++;
    }
    await copyFile(source, destination);
    await chmod(destination, stat.mode & 0o111 ? 0o755 : 0o644);
  }
  await copy("");
  return { nativeAddonCount };
}

async function copyNamedFile(relative, destination) {
  assertSafeReleasePath(relative);
  const source = path.join(root, relative);
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink() || !isWithin(await realpath(root), await realpath(source))) fail("Explicit release inputs must be regular repository files.");
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
  await copyFile(source, destination);
  await chmod(destination, 0o644);
}

async function sha256(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  if (process.argv.length !== 2) fail("This packager takes no arguments; use the release workflow.");
  if (process.platform !== "linux" || process.arch !== "x64") fail("Build the server release on Linux x64; Windows node_modules cannot be deployed to Linux.");
  if (process.versions.node !== requiredNodeVersion) fail(`Build with Node.js ${requiredNodeVersion}.`);
  const sourceSha = process.env.GITHUB_SHA;
  if (!/^[0-9a-f]{40}$/.test(sourceSha || "")) fail("GITHUB_SHA must identify the full source commit.");
  if (process.env.APP_LOCAL_MODE !== "0" || process.env.NEXT_PUBLIC_APP_LOCAL_MODE !== "0" || process.env.NEXT_PUBLIC_APP_BASE_PATH !== requiredBasePath) fail("Use the authenticated /zhijing server build environment.");
  if ((await readdir(root)).some(name => /^\.env/i.test(name) && name !== ".env.example")) fail("Do not package a checkout containing private environment files.");
  if (["APP_ADMIN_EMAIL", "APP_ADMIN_PASSWORD", "API_KEY_ENCRYPTION_SECRET", "OPENAI_API_KEY", "ARK_API_KEY"].some(name => process.env[name])) fail("The build must not have production credentials in its environment.");

  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (packageJson.packageManager !== requiredPnpmVersion || packageJson.type !== "module") fail("The release requires the pinned package manager and ESM package scope.");
  const standalone = path.join(root, ".next", "standalone");
  const standaloneEntries = await readdir(standalone);
  if (standaloneEntries.some(name => ![".next", "node_modules", "package.json", "server.js", "public", "drizzle"].includes(name))) fail("Unexpected files appeared at the standalone root; review the trace before publishing.");
  const serverSource = await readFile(path.join(standalone, "server.js"), "utf8");
  if (!serverSource.includes('"basePath":"/zhijing"')) fail("The standalone server was not built for /zhijing.");
  const vueHtml = await readFile(path.join(root, "public", "workbench", "index.html"), "utf8");
  if (!vueHtml.includes("/zhijing/workbench/")) fail("Vue was not built for the same deployment prefix.");

  const nextDirectory = await realpath(path.join(root, ".next"));
  if (!isWithin(await realpath(root), nextDirectory)) fail("The build directory must stay within the repository.");
  const outputDirectory = path.join(nextDirectory, "server-release");
  await mkdir(outputDirectory, { recursive: true, mode: 0o755 });
  if (await realpath(outputDirectory) !== outputDirectory || (await readdir(outputDirectory)).length) fail("The release output directory must be a real, empty directory.");
  const staging = await mkdtemp(path.join(nextDirectory, "zhijing-release-"));
  try {
    // The existing launcher copies these three directories from the release
    // root. Do not package duplicate copies left by source HTTP verification.
    const copied = await copyReleaseTree(standalone, path.join(staging, ".next", "standalone"), {
      skip: relative => /^(?:public|drizzle|\.next\/static)(?:\/|$)/.test(relative),
    });
    await copyReleaseTree(path.join(root, ".next", "static"), path.join(staging, ".next", "static"));
    await copyReleaseTree(path.join(root, "public", "workbench"), path.join(staging, "public", "workbench"));
    for (const relative of publicFiles) await copyNamedFile(`public/${relative}`, path.join(staging, "public", relative));
    for (const relative of sourceFiles) await copyNamedFile(relative, path.join(staging, relative));
    const migrationNames = (await readdir(path.join(root, "drizzle"))).filter(name => /^\d{4,}_[a-z0-9_]+\.sql$/.test(name)).sort();
    if (!migrationNames.length) fail("The business-schema migrations are missing.");
    for (const name of migrationNames) await copyNamedFile(`drizzle/${name}`, path.join(staging, "drizzle", name));

    const manifest = {
      formatVersion: 1,
      sourceSha,
      nodeVersion: process.versions.node,
      packageManager: requiredPnpmVersion,
      platform: process.platform,
      architecture: process.arch,
      operatingSystem: "Ubuntu 22.04 (glibc)",
      appBasePath: requiredBasePath,
      appLocalMode: "0",
      publicAppLocalMode: "0",
      applicationVersion: packageJson.version,
      nativeAddonCount: copied.nativeAddonCount,
      launcher: "scripts/start-server.mjs",
      externalDataDirectoryRequired: true,
      productionCredentialsIncluded: false,
    };
    await writeFile(path.join(staging, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644, flag: "wx" });

    const archiveName = `zhijing-linux-x64-${sourceSha}.tar.gz`;
    const archive = path.join(outputDirectory, archiveName);
    const result = spawnSync("tar", [
      "--sort=name", "--format=posix", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
      "--pax-option=delete=atime,delete=ctime", "--create", "--gzip", "--file", archive,
      "--directory", staging, ".",
    ], { stdio: "inherit" });
    if (result.error || result.status !== 0) fail("Unable to create the server release archive.");
    await writeFile(`${archive}.sha256`, `${await sha256(archive)}  ${archiveName}\n`, { mode: 0o644, flag: "wx" });
    process.stdout.write(JSON.stringify({ ...manifest, archive: `.next/server-release/${archiveName}`, checksum: `.next/server-release/${archiveName}.sha256` }, null, 2) + "\n");
  } finally {
    const resolved = await realpath(staging);
    if (path.dirname(resolved) !== nextDirectory || !path.basename(resolved).startsWith("zhijing-release-")) fail("Refusing to remove an unexpected staging directory.");
    await rm(resolved, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`Server release packaging failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
