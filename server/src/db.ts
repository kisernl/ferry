import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "0001_init",
    sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer','editor')),
  restricted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE projects (
  name TEXT PRIMARY KEY,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE environments (
  project TEXT NOT NULL REFERENCES projects(name) ON DELETE CASCADE,
  name TEXT NOT NULL,
  protected INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project, name)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  user_login TEXT,
  ip TEXT,
  action TEXT NOT NULL,
  project TEXT,
  environment TEXT,
  key_name TEXT,
  detail TEXT
);
CREATE INDEX idx_audit_ts ON audit_log(ts);

CREATE TABLE github_owners (
  owner TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('all','selected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE github_repos (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  project TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner, repo, project)
);
`,
  },
];

export function openDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "ferry.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const applied = new Set(
    (db.prepare("SELECT id FROM migrations").all() as { id: string }[]).map(
      (r) => r.id,
    ),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO migrations (id) VALUES (?)").run(m.id);
    })();
  }
}

/** Startup task: drop audit rows older than the retention window. */
export function pruneAuditLog(db: Database.Database, days = 365): void {
  db.prepare(
    "DELETE FROM audit_log WHERE ts < datetime('now', ?)",
  ).run(`-${days} days`);
}
