// Keep the browser request alive long enough to receive the server's timeout response.
export const COPY_GENERATION_TIMEOUT_MS = 180_000;
export const COPY_CLIENT_TIMEOUT_MS = COPY_GENERATION_TIMEOUT_MS + 15_000;
export const COPY_SLOW_NOTICE_MS = 45_000;
export const COPY_TIMEOUT_MESSAGE = "文案接口等待 3 分钟仍未完成，请先检查服务商结果，再手动重试。";
export const COPY_SLOW_MESSAGE = "服务商响应较慢，仍在等待，请勿重复提交 · 最长等待 3 分钟";
