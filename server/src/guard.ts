import type { FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import type { Config } from "@ferry/shared";
import { adminLogins } from "./config.js";
import { ApiError, forbidden } from "./lib/errors.js";
import {
  resolveSession,
  SESSION_COOKIE,
  type SessionUser,
} from "./lib/session.js";

export type Role = "viewer" | "editor" | "admin";
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export interface AuthedUser extends SessionUser {
  effectiveRole: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthedUser;
    sessionId?: string;
  }
}

export function user(req: FastifyRequest): AuthedUser {
  if (!req.user) throw new ApiError(401, "UNAUTHORIZED", "sign in required");
  return req.user;
}

/** preHandler: session + CSRF. Use `requireRole(role)` for the role floor. */
export function makeGuard(db: Database.Database, config: Config) {
  const admins = adminLogins(config);

  async function requireAuth(req: FastifyRequest): Promise<void> {
    const sid = req.cookies[SESSION_COOKIE];
    const sessionUser = sid ? resolveSession(db, sid) : null;
    if (!sid || !sessionUser) {
      throw new ApiError(401, "UNAUTHORIZED", "sign in required");
    }
    req.sessionId = sid;
    req.user = {
      ...sessionUser,
      effectiveRole: admins.has(sessionUser.login.toLowerCase())
        ? "admin"
        : sessionUser.role,
    };
  }

  function requireRole(min: Role) {
    return async (req: FastifyRequest) => {
      await requireAuth(req);
      if (RANK[user(req).effectiveRole] < RANK[min]) {
        throw forbidden("insufficient role");
      }
    };
  }

  /** For writes inside an environment: enforces protected-env confirmation
   *  and the restricted-editor rule. */
  async function envWriteGuard(req: FastifyRequest): Promise<void> {
    const { project, env } = req.params as { project: string; env: string };
    const row = db
      .prepare(
        "SELECT protected FROM environments WHERE project = ? AND name = ?",
      )
      .get(project, env) as { protected: number } | undefined;
    if (!row?.protected) return;

    if (user(req).restricted) {
      throw forbidden("restricted editors cannot modify protected environments");
    }
    if (req.headers["x-confirm"] !== env) {
      throw new ApiError(
        428,
        "CONFIRM_REQUIRED",
        `writes to protected environment "${env}" require X-Confirm: ${env}`,
      );
    }
  }

  return { requireAuth, requireRole, envWriteGuard };
}
