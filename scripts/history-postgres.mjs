import nextEnv from "@next/env";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgresHistoryStore } from "../lib/postgres-history.ts";
import { importSqliteHistory } from "../lib/history-migration.ts";

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
if (!process.env.HISTORY_DATABASE_URL) throw new Error("Set HISTORY_DATABASE_URL in .env.local; never pass credentials on the command line");
const target = new PostgresHistoryStore(process.env.HISTORY_DATABASE_URL);
try {
  const command = process.argv[2];
  if (command === "init") {
    await target.pool.query(readFileSync(resolve("db/postgres-history.sql"), "utf8"));
    console.log("Private PostgreSQL history schema initialized.");
  } else if (command === "import-sqlite") {
    const path = resolve(process.argv[3] || process.env.HISTORY_DB_PATH || "data/debate-history.sqlite");
    const source = new DatabaseSync(path, { readOnly: true });
    try { console.log("Migration completed; source preserved:", await importSqliteHistory(source, target)); }
    finally { source.close(); }
  } else throw new Error("Use init or import-sqlite [source database path]. Stop web/worker writes and back up SQLite before importing.");
} catch (error) {
  // Database errors may contain connection details; print only codes and known safe messages.
  console.error("PostgreSQL history operation failed:", error.code || (error.message?.startsWith("Migration conflict") ? error.message : "Check database connectivity, schema, and source path."));
  process.exitCode = 1;
} finally { await target.close(); }
