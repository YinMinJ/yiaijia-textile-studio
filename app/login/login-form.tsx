"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import styles from "./login.module.css";
import { appPath } from "../../lib/app-path";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(appPath("/api/auth/login"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) {
        let message = typeof result.error === "string" ? result.error : "登录失败，请稍后重试。";
        if (response.status === 429 && typeof result.retryAfter === "number" && result.retryAfter > 0) {
          message = `登录尝试过于频繁，请在约 ${Math.ceil(result.retryAfter / 60)} 分钟后重试。`;
        }
        setError(message);
        setPassword("");
        return;
      }
      setPassword("");
      window.location.assign(appPath("/"));
    } catch {
      setError("暂时无法连接工作台，请检查网络后重试。");
    } finally {
      clearTimeout(timeout);
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-busy={pending}>
      <label htmlFor="login-email" className="form-label">邮箱</label>
      <input id="login-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
        placeholder="请输入你的邮箱" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)}
        disabled={pending} aria-describedby={error ? "login-error" : undefined} />

      <label htmlFor="login-password" className="form-label">密码</label>
      <div className={styles.passwordField}>
        <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password"
          placeholder="请输入密码" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)}
          disabled={pending} aria-describedby={error ? "login-error" : undefined} />
        <button type="button" className={styles.toggle} aria-label={showPassword ? "隐藏密码" : "显示密码"}
          aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} disabled={pending}>
          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>

      {error && <p id="login-error" role="alert" className={styles.error}>{error}</p>}
      <button type="submit" className={`btn primary ${styles.submit}`} disabled={pending}>
        {pending ? <><LoaderCircle size={18} className="spin" aria-hidden="true" />正在登录…</> : <>进入工作台<ArrowRight size={18} aria-hidden="true" /></>}
      </button>
    </form>
  );
}
