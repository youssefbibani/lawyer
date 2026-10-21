/**
 * Authentication: Better Auth (email + password, sessions, organization membership, TOTP 2FA,
 * rate limiting). Business authorization (roles per office, per-case access) is enforced in
 * server/services/authorization.ts on every API call.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { organization, twoFactor } from "better-auth/plugins";

import { prisma } from "./db.js";
import { env, trustedOrigins } from "./env.js";
import { getMailer } from "./services/mailer.js";

export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours
export const PASSWORD_MIN_LENGTH = 10;
export const CLIENT_IP_HEADER = "x-qasr-client-ip";

export function authOptions() {
  const e = env();
  return {
    appName: "قصر العدالة",
    baseURL: e.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(e),
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      // Accounts are created by office administrators, never by public sign-up.
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      // Requests are refused before reaching this point when no mail service is configured
      // (routes/auth.ts), so the answer never depends on whether the account exists.
      async sendResetPassword({ user, url }) {
        const result = await getMailer().send({
          to: user.email,
          subject: "إعادة تعيين كلمة المرور — قصر العدالة",
          text: `لإعادة تعيين كلمة المرور افتح الرابط التالي خلال ساعة:\n${url}\n\nإذا لم تطلب ذلك فتجاهل هذه الرسالة.`,
        });
        if (!result.ok) {
          // Never log the link (it contains the reset token) nor the address.
          console.error(`[auth] password reset e-mail not delivered (user ${user.id}): ${result.reason}`);
        }
      },
    },
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 60 * 60,
      freshAge: 60 * 10,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      // Better Auth prunes rows older than the global window, so it must cover the longest custom
      // window below (otherwise a 5-minute limit would be forgotten after 1 minute).
      window: 900,
      max: 900,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
        "/reset-password": { window: 300, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
        "/change-password": { window: 300, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "qasr",
      useSecureCookies: e.NODE_ENV === "production",
      // The HTTP layer resolves the client address (socket, or X-Forwarded-For behind a trusted
      // proxy) and passes it in this internal header; any inbound copy of it is discarded.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    databaseHooks: {
      session: {
        create: {
          // Every session starts inside the user's office (first active membership). Accounts whose
          // memberships are all deactivated cannot sign in. The active office is re-validated
          // against the membership table on every API request.
          async before(session) {
            const membership = await prisma.member.findFirst({
              where: { userId: session.userId, deactivatedAt: null },
              orderBy: { createdAt: "asc" },
            });
            if (!membership) {
              throw new APIError("FORBIDDEN", { message: "Account disabled", code: "ACCOUNT_DISABLED" });
            }
            return { data: { ...session, activeOrganizationId: membership.organizationId } };
          },
        },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        creatorRole: "admin",
      }),
      twoFactor({ issuer: "Qasr al-Adala" }),
    ],
  } satisfies BetterAuthOptions;
}

function createAuth() {
  return betterAuth(authOptions());
}

let instance: ReturnType<typeof createAuth> | undefined;

export function auth() {
  instance ??= createAuth();
  return instance;
}
