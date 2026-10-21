/**
 * HTTP client for the office backend (/api/v1). Same-origin requests carry the httpOnly session
 * cookie; the browser adds the Origin header the server checks against CSRF. Errors are thrown as
 * ApiError with the server's Arabic message — the UI never invents a success.
 */
import type { ApiErrorBody, ErrorCode } from "../../shared/api";

export type ClientErrorCode = ErrorCode | "NETWORK";

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status: number,
    readonly details: { path: string; message: string }[] = [],
    readonly data?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export function isApiError(err: unknown, code?: ClientErrorCode): err is ApiError {
  return err instanceof ApiError && (!code || err.code === code);
}

/** Notified on 401 so the app can return to the sign-in screen. */
let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: (() => void) | null) {
  onUnauthenticated = fn;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(path.startsWith("/api/") ? path : `/api/v1${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError("NETWORK", "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم أعد المحاولة. لم يُحفظ أي تغيير.", 0);
  }
  const type = res.headers.get("content-type") ?? "";
  const payload = type.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const body = payload as ApiErrorBody | null;
    const error = body?.error
      ? new ApiError(body.error.code, body.error.message, res.status, body.error.details, body.error.data, body.error.requestId)
      : new ApiError(res.status >= 500 ? "INTERNAL" : "VALIDATION_FAILED", res.status >= 500 ? "الخادم غير متاح حالياً. أعد المحاولة بعد قليل." : "تعذّر تنفيذ الطلب.", res.status);
    if (res.status === 401) onUnauthenticated?.();
    throw error;
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body: unknown = {}, idempotencyKey?: string) => request<T>(path, { method: "POST", body, idempotencyKey }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body }),
};

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : "";
}

/** A fresh key per user intent; retries of the same submission reuse it. */
export function newIdempotencyKey(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `web-${random}`;
}

/** First field error for a form field, if the server reported one. */
export function fieldError(err: unknown, path: string): string | undefined {
  return isApiError(err) ? err.details.find((d) => d.path === path)?.message : undefined;
}
