#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createAccount, createInitialAccount, ensureBootstrapAdmin, hasAccounts, AuthInputError, AuthConfigurationError } from "../lib/auth-core.ts";

const MAX_INPUT_BYTES = 8192;

function help() {
  process.stdout.write(`创建织境工作台账户\n\n用法：\n  node --env-file-if-exists=.env scripts/create-user.mjs [--if-empty]\n\n交互模式询问邮箱、显示名称和密码；密码输入不回显。\n自动化模式通过标准输入传入 JSON 对象，字段为 email、password、displayName（可选）。\n--if-empty：已有账户直接退出；空库先使用明确配置的初始管理员，否则提示创建。\n不要把密码作为命令行参数；密码须为 12–256 个字符。\n`);
}

async function readJsonInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_INPUT_BYTES) throw new AuthInputError("标准输入超过 8 KB。");
    chunks.push(buffer);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  } catch {
    throw new AuthInputError("标准输入必须是有效 JSON 对象，包含 email、password，可选 displayName。");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuthInputError("标准输入必须是 JSON 对象。");
  }
  return input;
}

async function readTerminalInput() {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stderr.write(chunk, encoding);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  rl.on("SIGINT", () => {
    muted = false;
    process.stderr.write("\n已取消，未创建账户。\n");
    rl.close();
    process.exitCode = 130;
  });
  async function ask(prompt, hide = false) {
    process.stderr.write(prompt);
    muted = hide;
    try {
      return await rl.question("");
    } finally {
      muted = false;
      if (hide) process.stderr.write("\n");
    }
  }
  try {
    const email = await ask("邮箱：");
    const displayName = await ask("显示名称（可留空）：");
    const password = await ask("密码（至少 12 个字符，不回显）：", true);
    const confirmation = await ask("再次输入密码：", true);
    if (password !== confirmation) throw new AuthInputError("两次输入的密码不一致，未创建账户。");
    return { email, displayName, password };
  } finally {
    rl.close();
  }
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 1 && ["--help", "-h"].includes(arguments_[0])) {
    help();
    return;
  }
  const ifEmpty = arguments_.length === 1 && arguments_[0] === "--if-empty";
  if (arguments_.length && !ifEmpty) throw new AuthInputError("仅接受 --if-empty；请使用交互模式或标准输入 JSON 提供凭据。");
  if (ifEmpty) {
    await ensureBootstrapAdmin();
    if (hasAccounts()) {
      process.stdout.write("账户已就绪。\n");
      return;
    }
  }
  const input = process.stdin.isTTY ? await readTerminalInput() : await readJsonInput();
  const user = ifEmpty ? await createInitialAccount(input) : await createAccount(input);
  if (!user) {
    process.stdout.write("账户已就绪。\n");
    return;
  }
  process.stdout.write(`账户已创建：${user.email}（${user.displayName}）\n`);
}

main().catch((error) => {
  if (process.exitCode === 130) return;
  // Keep runtime/SQL errors and arbitrary input out of logs. No passwords are printed.
  const message = error instanceof AuthInputError || error instanceof AuthConfigurationError ? error.message : "账户创建失败，请检查数据目录的路径和写入权限。";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
