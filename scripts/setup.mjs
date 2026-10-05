import {existsSync, copyFileSync, chmodSync} from "node:fs";
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 24 || (major === 24 && minor < 11)) { console.error("需要 Node.js 24.11 或更高版本。"); process.exit(1); }
if (!existsSync(".env")) { copyFileSync(".env.example", ".env"); chmodSync(".env", 0o600); console.log("已创建 .env，本机默认地址为 http://localhost:3000。"); }
else console.log("使用已有 .env 配置。");
console.log("本机模式无需创建登录账户。接下来执行 pnpm build 和 pnpm start，浏览器打开 http://127.0.0.1:3000。");
