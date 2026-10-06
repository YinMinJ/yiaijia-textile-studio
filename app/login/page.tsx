import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Layers3, LockKeyhole } from "lucide-react";
import { getCurrentUser } from "../../lib/auth.ts";
import { appPath } from "../../lib/app-path.ts";
import LoginForm from "./login-form";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "登录 · 织境" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(appPath("/"));

  return (
    <main className={styles.shell}>
      <section className={styles.card} aria-labelledby="login-title">
        <div className={styles.brand}>
          <span className="brand-mark" aria-hidden="true"><Layers3 size={24} strokeWidth={1.6} /></span>
          <div><strong>织境</strong><span>家纺设计工作台</span></div>
        </div>
        <span className={styles.eyebrow}>YOUR CREATIVE WORKSPACE</span>
        <h1 id="login-title">登录工作台</h1>
        <p className={styles.intro}>从一张商品实拍开始，完成你的下一套作品。</p>
        <LoginForm />
        <p className={styles.help}><LockKeyhole size={14} aria-hidden="true" />使用管理员为你创建的邮箱和密码登录。</p>
      </section>
      <p className={styles.footer}>织境 · 让好产品被看见</p>
    </main>
  );
}
