import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
for (const filename of [".env.local", ".env"]) {
  try { process.loadEnvFile(path.join(root, filename)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

const nextEntry = path.join(root, "node_modules", "next", "dist", "bin", "next");
const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
for (const entry of [nextEntry, viteEntry]) {
  try { await access(entry); }
  catch { console.error("开发依赖尚未安装，请先运行 pnpm install。"); process.exit(1); }
}

const environment = {
  ...process.env,
  APP_LOCAL_MODE: "1",
  APP_URL: "http://127.0.0.1:3000",
  DATA_DIR: path.resolve(root, process.env.DATA_DIR || "data"),
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_ENV: "development",
};

const children = [];
let stopping = false;

function launch(name, entry, args) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: root,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`${name} 启动失败：${error.message}`);
    void stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      if (code || signal) console.error(`${name} 已退出${signal ? `（${signal}）` : `（${code}）`}。`);
      void stop(code ?? 1);
    }
  });
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform === "win32") {
    // Next dev has a worker process; stop its process tree, including that worker.
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => { child.kill(); resolve(); });
      killer.once("exit", resolve);
    });
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    child.kill("SIGTERM");
  });
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map(stopChild));
  process.exit(code);
}

process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));
process.once("uncaughtException", (error) => { console.error(error); void stop(1); });
process.once("unhandledRejection", (error) => { console.error(error); void stop(1); });

console.log("Vue 3 工作台：http://127.0.0.1:3000（API 开发服务：127.0.0.1:3002）");
launch("Next API", nextEntry, ["dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3002"]);
launch("Vue 工作台", viteEntry, ["--host", "127.0.0.1", "--port", "3000", "--strictPort"]);
