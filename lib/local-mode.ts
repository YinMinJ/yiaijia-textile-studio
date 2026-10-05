import { AuthConfigurationError, getAppUrl, type AuthUser } from "./auth-core.ts";

/** Local mode is safe only with the launcher's loopback-only listener. */
export function getLocalModeUser(
  requestHeaders: Pick<Headers, "get">,
  environment: Record<string, string | undefined> = process.env,
): AuthUser | null {
  if (environment.APP_LOCAL_MODE !== "1") return null;
  if (!environment.APP_URL?.trim()) {
    throw new AuthConfigurationError("本机模式必须明确设置 APP_URL 本机地址。");
  }
  const appUrl = getAppUrl(environment.APP_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname)) {
    throw new AuthConfigurationError("本机免登录模式只允许 loopback 地址。");
  }

  // Match the actual Host exactly, including its port. Never replace it with
  // X-Forwarded-Host: a foreign site resolving to loopback must not gain access.
  if (requestHeaders.get("host") !== appUrl.host) return null;
  return { id: "local-user", email: "local@localhost", displayName: "本机用户" };
}
