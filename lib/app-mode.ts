// Both build tools inline the public mode in the browser bundle.
declare const process: { env: { NEXT_PUBLIC_APP_LOCAL_MODE?: string } };

export function appLocalMode(): boolean {
  const mode = process.env.NEXT_PUBLIC_APP_LOCAL_MODE ?? "1";
  if (mode !== "0" && mode !== "1") throw new Error("NEXT_PUBLIC_APP_LOCAL_MODE 必须是 0 或 1。");
  return mode === "1";
}
