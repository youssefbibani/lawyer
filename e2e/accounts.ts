import { readFileSync } from "node:fs";

export interface Accounts {
  tag: string;
  password: string;
  admin: string;
  lawyer: string;
  clerk: string;
  caseReference: string;
  caseId: string;
}

export const accounts = (): Accounts => JSON.parse(readFileSync("e2e/.state/accounts.json", "utf8")) as Accounts;
export const stateFor = (role: "admin" | "lawyer" | "clerk") => `e2e/.state/${role}.json`;
