#!/usr/bin/env node
/**
 * Protected-scope guard (Phase 3).
 *
 * The AI assistant, voice, OCR, smart archive, approval engine and document viewer — and the
 * local in-browser store they depend on — are out of scope for the backend phase and must not
 * change. This script records SHA-256 hashes of those files and verifies them later.
 *
 *   node scripts/protected-files.mjs --write   # record the baseline
 *   node scripts/protected-files.mjs --check   # fail if any protected file changed / disappeared
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "scripts", "protected-files.sha256.json");

/** Directories / files that belong to the protected modules (or are shared state they rely on). */
export const PROTECTED = [
  // AI assistant, speech, prompts
  "src/services/assistant",
  "src/services/speech",
  "src/components/assistant",
  "src/pages/Assistant.tsx",
  "src/pages/BriefEditor.tsx",
  "src/config.ts",
  // Smart archive, OCR, classification, retrieval / search
  "src/services/archive",
  "src/services/retrieval.ts",
  "src/components/archive",
  "src/pages/archive",
  "src/pages/ArchiveSearch.tsx",
  "src/hooks/use-blob-url.ts",
  // Document viewer
  "src/components/documents",
  "src/pages/DocumentViewer.tsx",
  // AI approval engine + its audit chain
  "src/services/approvals.ts",
  "src/services/audit.ts",
  "src/components/approvals",
  "src/pages/Approvals.tsx",
  // Local in-browser store and shared types used by the protected modules
  "src/services/api.ts",
  "src/services/db.ts",
  "src/services/permissions.ts",
  "src/data/mock.ts",
  "src/types/index.ts",
  "src/lib/hash.ts",
  // Tests of the protected modules
  "src/tests/assistant-engine.test.ts",
  "src/tests/assistant-ui.test.tsx",
  "src/tests/intent.test.ts",
  "src/tests/retrieval.test.ts",
  "src/tests/archive-workflow.test.ts",
  "src/tests/archive-analysis.test.ts",
  "src/tests/approvals-ui.test.tsx",
];

function files(rel) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs).flatMap((name) => files(path.posix.join(rel, name)));
}

function snapshot() {
  const out = {};
  for (const entry of PROTECTED) {
    for (const rel of files(entry)) {
      // Hash content with normalised line endings so checkouts on other OSes compare equal.
      const content = readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
      out[rel] = createHash("sha256").update(content).digest("hex");
    }
  }
  return out;
}

const mode = process.argv[2];
if (mode === "--write") {
  const snap = snapshot();
  writeFileSync(manifestPath, `${JSON.stringify(snap, null, 2)}\n`);
  console.log(`Recorded ${Object.keys(snap).length} protected files.`);
} else if (mode === "--check") {
  const expected = JSON.parse(readFileSync(manifestPath, "utf8"));
  const actual = snapshot();
  const changed = Object.keys(expected).filter((f) => actual[f] && actual[f] !== expected[f]);
  const missing = Object.keys(expected).filter((f) => !actual[f]);
  const added = Object.keys(actual).filter((f) => !expected[f]);
  for (const f of changed) console.error(`CHANGED  ${f}`);
  for (const f of missing) console.error(`MISSING  ${f}`);
  for (const f of added) console.error(`ADDED    ${f}`);
  if (changed.length || missing.length || added.length) {
    console.error(`Protected scope violated (${changed.length} changed, ${missing.length} missing, ${added.length} added).`);
    process.exit(1);
  }
  console.log(`OK — ${Object.keys(expected).length} protected files unchanged.`);
} else {
  console.error("Usage: node scripts/protected-files.mjs --write | --check");
  process.exit(2);
}
