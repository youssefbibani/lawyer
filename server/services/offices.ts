/**
 * Office bootstrap (used by the CLI `npm run office:create`, the development seed and tests).
 * Public sign-up is disabled, so this is the only way an office and its first administrator exist.
 */
import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import type { Role } from "../../shared/api.js";
import { prisma } from "../db.js";
import type { Actor, Ctx } from "../http/context.js";
import { AppError } from "../http/errors.js";
import { hashPassword } from "./settings.js";

const newId = () => randomUUID().replace(/-/g, "");

export interface NewUser {
  name: string;
  email: string;
  password: string;
  role: Role;
  phone?: string;
  barNumber?: string;
}

export async function createOffice(input: {
  name: string;
  slug: string;
  admin: Omit<NewUser, "role">;
  settings?: Partial<Omit<Prisma.OfficeSettingsUncheckedCreateInput, "organizationId" | "legalName">>;
}): Promise<{ organizationId: string; adminUserId: string }> {
  if (input.admin.password.length < 10) throw new AppError("VALIDATION_FAILED", "Password must be at least 10 characters.");
  const hash = await hashPassword(input.admin.password);
  return prisma.$transaction(async (tx) => {
    if (await tx.organization.findUnique({ where: { slug: input.slug } })) throw new AppError("CONFLICT", `Office slug "${input.slug}" already exists.`);
    const now = new Date();
    const organizationId = newId();
    await tx.organization.create({ data: { id: organizationId, name: input.name, slug: input.slug, createdAt: now } });
    await tx.officeSettings.create({ data: { organizationId, legalName: input.name, ...input.settings } });
    const adminUserId = await insertUser(tx, organizationId, { ...input.admin, role: "admin" }, hash, now);
    await tx.auditLog.create({
      data: { organizationId, actorId: null, resourceType: "office", resourceId: organizationId, operation: "office.create", summary: "إنشاء المكتب (تهيئة أولية)" },
    });
    return { organizationId, adminUserId };
  });
}

type TxLike = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function insertUser(tx: TxLike, organizationId: string, user: NewUser, passwordHash: string, now = new Date()): Promise<string> {
  const email = user.email.trim().toLowerCase();
  if (await tx.user.findUnique({ where: { email } })) throw new AppError("CONFLICT", `A user with email ${email} already exists.`);
  const userId = newId();
  await tx.user.create({ data: { id: userId, name: user.name, email, emailVerified: true, createdAt: now, updatedAt: now } });
  await tx.account.create({ data: { id: newId(), accountId: userId, providerId: "credential", userId, password: passwordHash, createdAt: now, updatedAt: now } });
  await tx.member.create({ data: { id: newId(), organizationId, userId, role: user.role, createdAt: now, phone: user.phone ?? null, barNumber: user.barNumber ?? null } });
  await tx.notificationPreference.create({ data: { organizationId, userId } });
  return userId;
}

export async function addUser(organizationId: string, user: NewUser): Promise<string> {
  const hash = await hashPassword(user.password);
  return prisma.$transaction((tx) => insertUser(tx, organizationId, user, hash));
}

/** Builds the server-side actor for a member (seed, tests, CLI). */
export async function actorFor(userId: string, organizationId: string): Promise<Actor> {
  const m = await prisma.member.findUniqueOrThrow({
    where: { organizationId_userId: { organizationId, userId } },
    include: { user: true, organization: { include: { settings: true } } },
  });
  const s = m.organization.settings!;
  return {
    userId,
    name: m.user.name,
    email: m.user.email,
    sessionId: "system",
    organizationId,
    role: m.role as Role,
    office: {
      legalName: s.legalName,
      timeZone: s.timeZone,
      defaultCurrency: s.defaultCurrency,
      lawyersSeeAllCases: s.lawyersSeeAllCases,
      clerksSeeAllCases: s.clerksSeeAllCases,
      clerksCanRecordPayments: s.clerksCanRecordPayments,
    },
  };
}

export async function systemCtx(userId: string, organizationId: string, requestId = "seed"): Promise<Ctx> {
  return { actor: await actorFor(userId, organizationId), meta: { requestId, ip: null, userAgent: "system" } };
}

