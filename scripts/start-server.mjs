import { cp, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
for (const filename of [".env.local", ".env"]) {
  try { process.loadEnvFile(path.join(root, filename)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
const standalone = path.join(root, ".next", "standalone");
try {
  await access(path.join(standalone, "server.js"));
} catch {
  console.error("尚未构建生产版本，请先运行 pnpm build。");
  process.exit(1);
}

// Next's standalone entry changes cwd. Keep user data anchored to the project.
process.env.DATA_DIR = path.resolve(root, process.env.DATA_DIR || "data");
process.env.HOSTNAME = "127.0.0.1";
process.env.PORT ||= "3000";
process.env.APP_URL ||= `http://127.0.0.1:${process.env.PORT}`;
process.env.APP_LOCAL_MODE ||= "1";
process.env.NEXT_TELEMETRY_DISABLED = "1";
process.env.NODE_ENV = "production";
await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
await cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
await cp(path.join(root, "drizzle"), path.join(standalone, "drizzle"), { recursive: true });
await import(pathToFileURL(path.join(standalone, "server.js")).href);
