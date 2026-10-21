/**
 * Sign-in, two-factor and password flows against Better Auth (/api/auth). The session itself is
 * an httpOnly cookie: the page never sees or stores a token.
 */
import { AUTH_ERROR_MESSAGES } from "./labels";
import { ApiError } from "./http";

async function authCall<T>(path: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/auth${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("NETWORK", "تعذّر الاتصال بالخادم. تحقّق من الاتصال ثم أعد المحاولة.", 0);
  }
  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    // Our own layer answers with { error: {...} }; Better Auth with { code, message }.
    const ours = payload?.error as { code?: string; message?: string } | undefined;
    const code = ours?.code ?? (payload?.code as string | undefined) ?? "";
    const message =
      ours?.message ??
      AUTH_ERROR_MESSAGES[code] ??
      (res.status === 429 ? "محاولات كثيرة في وقت قصير. انتظر قليلاً ثم أعد المحاولة." : res.status >= 500 ? "الخادم غير متاح حالياً. أعد المحاولة بعد قليل." : "تعذّر إتمام العملية.");
    throw new ApiError(res.status === 429 ? "RATE_LIMITED" : res.status === 401 ? "UNAUTHENTICATED" : res.status === 403 ? "FORBIDDEN" : res.status >= 500 ? "INTERNAL" : "VALIDATION_FAILED", message, res.status, [], { authCode: code });
  }
  return (payload ?? {}) as T;
}

export async function signIn(email: string, password: string, rememberMe = true): Promise<{ twoFactor: boolean }> {
  const res = await authCall<{ twoFactorRedirect?: boolean }>("/sign-in/email", { email, password, rememberMe });
  return { twoFactor: !!res.twoFactorRedirect };
}

export const verifyTotp = (code: string, trustDevice = false) => authCall("/two-factor/verify-totp", { code, trustDevice });
export const verifyBackupCode = (code: string) => authCall("/two-factor/verify-backup-code", { code });
export const signOut = () => authCall("/sign-out", {});

export const requestPasswordReset = (email: string) => authCall("/request-password-reset", { email, redirectTo: `${window.location.origin}/reset-password` });
export const resetPassword = (token: string, newPassword: string) => authCall("/reset-password", { token, newPassword });
export const changePassword = (currentPassword: string, newPassword: string, revokeOtherSessions: boolean) =>
  authCall("/change-password", { currentPassword, newPassword, revokeOtherSessions });
export const revokeOtherSessions = () => authCall("/revoke-other-sessions", {});

export const enableTwoFactor = (password: string) => authCall<{ totpURI: string; backupCodes: string[] }>("/two-factor/enable", { password });
export const confirmTwoFactor = (code: string) => authCall("/two-factor/verify-totp", { code });
export const disableTwoFactor = (password: string) => authCall("/two-factor/disable", { password });

export const PASSWORD_MIN = 10;
