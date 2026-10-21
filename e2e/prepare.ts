/**
 * E2E fixture: creates a fresh office (unique per run) in the TEST database, signs each account
 * in through the real API, and writes Playwright storage states. Run by e2e/global-setup.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { prisma } from "../server/db.js";
import * as cases from "../server/services/cases.js";
import * as finance from "../server/services/finance.js";
import { addUser, createOffice, systemCtx } from "../server/services/offices.js";
import { closePdfBrowser } from "../server/services/receipt-pdf.js";

const API = process.env.E2E_API_URL!;
const ORIGIN = process.env.E2E_ORIGIN!;
const PASSWORD = "E2e-Passw0rd-2026";
const tag = Date.now().toString(36);
const email = (who: string) => `${who}.${tag}@e2e.example`;

const office = await createOffice({
  name: `مكتب التجربة ${tag}`,
  slug: `e2e-${tag}`,
  admin: { name: "مديرة التجربة", email: email("admin"), password: PASSWORD },
  settings: { address: "نهج الحرية", city: "تونس", taxId: "1234567/A/M/000" },
});
const lawyer = await addUser(office.organizationId, { name: "الأستاذ سامي التجربة", email: email("lawyer"), password: PASSWORD, role: "lawyer" });
const clerk = await addUser(office.organizationId, { name: "كاتبة التجربة", email: email("clerk"), password: PASSWORD, role: "clerk" });
const ctx = await systemCtx(lawyer, office.organizationId, "e2e");
const existing = await cases.createCase(ctx, {
  reference: `E2E/${tag}/1`,
  type: "CIVIL",
  court: "المحكمة الابتدائية بتونس",
  assignedLawyerId: lawyer,
  newClient: { type: "INDIVIDUAL", fullName: "حريف التجربة الأول" },
  memberIds: [clerk],
});
await finance.createAgreement(ctx, { caseId: existing.id, amount: "1200", title: "أتعاب الطور الابتدائي" });

mkdirSync("e2e/.state", { recursive: true });
let n = 0;
for (const [role, address] of [
  ["admin", email("admin")],
  ["lawyer", email("lawyer")],
  ["clerk", email("clerk")],
] as const) {
  n++;
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Forwarded-For": `10.99.0.${n}` },
    body: JSON.stringify({ email: address, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`E2E sign-in failed for ${role}: ${res.status}`);
  const cookies = res.headers.getSetCookie().map((raw) => {
    const [pair] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    return { name, value: rest.join("="), domain: new URL(ORIGIN).hostname, path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" as const };
  });
  writeFileSync(`e2e/.state/${role}.json`, JSON.stringify({ cookies, origins: [] }));
}

writeFileSync(
  "e2e/.state/accounts.json",
  JSON.stringify({ tag, password: PASSWORD, admin: email("admin"), lawyer: email("lawyer"), clerk: email("clerk"), caseReference: existing.reference, caseId: existing.id }),
);
await closePdfBrowser();
await prisma.$disconnect();
console.info(`[e2e] prepared office e2e-${tag}`);
