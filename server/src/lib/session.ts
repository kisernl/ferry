import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

export const SESSION_COOKIE = "__Host-ferry-session";
export const CSRF_COOKIE = "ferry-csrf";
export const CSRF_HEADER = "x-csrf-token";

export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000; // 12h
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000; // 2h

export interface SessionUser {
  id: number;
  githubId: number;
  login: string;
  avatarUrl: string | null;
  role: "viewer" | "editor";
  restricted: boolean;
}

interface SessionRow {
  id: string;
  user_id: number;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export function newId(): string {
  return randomBytes(32).toString("hex");
}

export function createSession(
  db: Database.Database,
  userId: number,
  ip: string,
  userAgent: string,
): string {
  const id = newId();
  db.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
     VALUES (?, ?, datetime('now', '+12 hours'), ?, ?)`,
  ).run(id, userId, ip, userAgent);
  return id;
}

export function destroySession(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function destroyUserSessions(db: Database.Database, userId: number): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/** Returns the session's user if the session exists and is inside both the
 *  absolute and idle windows; updates last_seen_at on success. */
export function resolveSession(
  db: Database.Database,
  id: string,
): SessionUser | null {
  const row = db
    .prepare(
      `SELECT id, user_id, created_at, last_seen_at, expires_at
       FROM sessions WHERE id = ?`,
    )
    .get(id) as SessionRow | undefined;
  if (!row) return null;

  const now = Date.now();
  const expired =
    now > Date.parse(row.expires_at + "Z") ||
    now - Date.parse(row.last_seen_at + "Z") > SESSION_IDLE_MS;
  if (expired) {
    destroySession(db, id);
    return null;
  }

  db.prepare(
    "UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?",
  ).run(id);

  const user = db
    .prepare(
      `SELECT id, github_id, login, avatar_url, role, restricted
       FROM users WHERE id = ?`,
    )
    .get(row.user_id) as
    | {
        id: number;
        github_id: number;
        login: string;
        avatar_url: string | null;
        role: "viewer" | "editor";
        restricted: number;
      }
    | undefined;
  if (!user) return null;

  return {
    id: user.id,
    githubId: user.github_id,
    login: user.login,
    avatarUrl: user.avatar_url,
    role: user.role,
    restricted: user.restricted === 1,
  };
}
