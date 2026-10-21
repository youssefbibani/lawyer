import { PrismaClient } from "@prisma/client";

/**
 * Single Prisma client per process. Prisma's own error log is disabled: its messages can quote
 * query arguments (client data). Failures are logged by the API error handler instead, with the
 * error code and first line only.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
