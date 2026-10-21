#!/usr/bin/env node
/**
 * Development helper: a project-local PostgreSQL cluster (no Docker required).
 * Uses the PostgreSQL binaries already installed on the machine (PG_BIN or PATH) and keeps all
 * data in ./.pgdata — it never touches a system PostgreSQL service.
 *
 *   node scripts/local-postgres.mjs init    # create the cluster + qasr_dev / qasr_test databases
 *   node scripts/local-postgres.mjs start | stop | status
 *
 * Local-only: the cluster listens on 127.0.0.1 and uses "trust" auth for the local OS user.
 * Never use this setup for shared or production databases (see docker-compose.yml / README_BACKEND.md).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".pgdata");
const port = process.env.LOCAL_PG_PORT ?? "54329";
const windowsDefault = "C:/Program Files/PostgreSQL/18/bin";
const binDir = process.env.PG_BIN ?? (process.platform === "win32" && existsSync(windowsDefault) ? windowsDefault : "");
const bin = (name) => (binDir ? path.join(binDir, process.platform === "win32" ? `${name}.exe` : name) : name);

function run(name, args, opts = {}) {
  return execFileSync(bin(name), args, { stdio: "inherit", ...opts });
}

/** pg_ctl start: the server inherits stdio, so detach it or the caller never returns (Windows). */
function startServer() {
  const r = spawnSync(
    bin("pg_ctl"),
    ["-D", dataDir, "-o", `-p ${port} -c listen_addresses=127.0.0.1`, "-l", path.join(dataDir, "server.log"), "-w", "start"],
    { stdio: "ignore" },
  );
  const status = spawnSync(bin("pg_ctl"), ["-D", dataDir, "status"], { encoding: "utf8" });
  console.log(status.stdout.split(/\r?\n/)[0] || `pg_ctl exited with ${r.status}`);
}

const cmd = process.argv[2];
switch (cmd) {
  case "init": {
    if (existsSync(dataDir)) {
      console.log(".pgdata already exists — skipping initdb.");
    } else {
      run("initdb", ["-D", dataDir, "-U", "lawyer", "-A", "trust", "-E", "UTF8", "--no-locale"]);
    }
    startServer();
    for (const db of ["qasr_dev", "qasr_test"]) {
      const r = spawnSync(bin("createdb"), ["-h", "127.0.0.1", "-p", port, "-U", "lawyer", db], { stdio: "pipe", encoding: "utf8" });
      console.log(r.status === 0 ? `created ${db}` : `${db}: ${r.stderr.trim()}`);
    }
    console.log(`\nDATABASE_URL=postgresql://lawyer@127.0.0.1:${port}/qasr_dev`);
    console.log(`DATABASE_URL_TEST=postgresql://lawyer@127.0.0.1:${port}/qasr_test`);
    break;
  }
  case "start":
    startServer();
    break;
  case "stop":
    run("pg_ctl", ["-D", dataDir, "-w", "stop"]);
    break;
  case "status":
    spawnSync(bin("pg_ctl"), ["-D", dataDir, "status"], { stdio: "inherit" });
    break;
  default:
    console.error("Usage: node scripts/local-postgres.mjs init | start | stop | status");
    process.exit(2);
}
