import { cookies, headers } from "next/headers";
import {
  ensureBootstrapAdmin,
  getAppUrl,
  getSessionUser,
  SESSION_COOKIE_NAME,
  type AuthUser,
} from "./auth-core.ts";
import { getLocalModeUser } from "./local-mode.ts";

export type { AuthUser } from "./auth-core.ts";

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (process.env.APP_LOCAL_MODE === "1") {
    return getLocalModeUser(await headers());
  }
  getAppUrl();
  await ensureBootstrapAdmin();
  const cookieStore = await cookies();
  return getSessionUser(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}
