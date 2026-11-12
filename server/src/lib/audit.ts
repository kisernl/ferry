import type Database from "better-sqlite3";

export interface AuditEntry {
  userLogin?: string | null;
  ip?: string | null;
  action: string;
  project?: string | null;
  environment?: string | null;
  key?: string | null;
  detail?: string | null;
}

/** One row per action — never write secret values here. */
export function audit(db: Database.Database, e: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_log (user_login, ip, action, project, environment, key_name, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    e.userLogin ?? null,
    e.ip ?? null,
    e.action,
    e.project ?? null,
    e.environment ?? null,
    e.key ?? null,
    e.detail ?? null,
  );
}
