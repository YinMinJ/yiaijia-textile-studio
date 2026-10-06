// Vite replaces this exact public environment expression in browser bundles.
declare const process: { env: { NEXT_PUBLIC_APP_BASE_PATH?: string } };

/** The public deployment prefix is compiled into both Next and Vue bundles. */
export function appBasePath(): string {
  const value = process.env.NEXT_PUBLIC_APP_BASE_PATH?.trim() || "";
  if (!value || value === "/") return "";
  const prefix = "/" + value.replace(/^\/+|\/+$/g, "");
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(prefix)) {
    throw new Error("NEXT_PUBLIC_APP_BASE_PATH 必须是站内路径，如 /zhijing。");
  }
  return prefix;
}

/** Resolve canonical stored asset URLs at the display/request boundary only. */
export function appPath(url: string): string {
  const prefix = appBasePath();
  if (!prefix || !url.startsWith("/") || url.startsWith("//")) return url;
  if (url === prefix || url.startsWith(prefix + "/") || url.startsWith(prefix + "?") || url.startsWith(prefix + "#")) return url;
  return prefix + url;
}
