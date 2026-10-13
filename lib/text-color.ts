export type CustomTextColor = `#${string}`;

/** Only opaque six-digit hex colors can be saved or passed to the canvas. */
export function isCustomTextColor(value: unknown): value is CustomTextColor {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
