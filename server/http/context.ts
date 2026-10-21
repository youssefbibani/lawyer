import type { Role } from "../../shared/api.js";

/** The authenticated caller, resolved on the server from the session — never from the request body. */
export interface Actor {
  userId: string;
  name: string;
  email: string;
  sessionId: string;
  organizationId: string;
  role: Role;
  office: {
    legalName: string;
    timeZone: string;
    defaultCurrency: string;
    lawyersSeeAllCases: boolean;
    clerksSeeAllCases: boolean;
    clerksCanRecordPayments: boolean;
  };
}

export interface RequestMeta {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

/** Passed to every service call: who is acting, and request metadata for the audit log. */
export interface Ctx {
  actor: Actor;
  meta: RequestMeta;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    clientIp: string | null;
    actor?: Actor;
  };
};
