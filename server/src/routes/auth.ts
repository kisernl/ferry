import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { Config } from "@ferry/shared";
import { allowedUserLogins } from "../config.js";
import { audit } from "../lib/audit.js";
import { ApiError } from "../lib/errors.js";
import {
  createSession,
  CSRF_COOKIE,
  destroySession,
  newId,
  SESSION_COOKIE,
} from "../lib/session.js";

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";
const STATE_COOKIE = "ferry-oauth-state";

export function authRoutes(app: FastifyInstance, db: Database.Database, config: Config) {
  const secure = config.PUBLIC_URL.startsWith("https://");
  const callbackUrl = `${config.PUBLIC_URL.replace(/\/$/, "")}/api/auth/github/callback`;

  app.get("/api/auth/github", async (req, reply) => {
    const state = newId();
    reply.setCookie(STATE_COOKIE, state, {
      path: "/api/auth",
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: 600,
    });
    const url = new URL(GITHUB_AUTHORIZE);
    url.searchParams.set("client_id", config.GITHUB_CLIENT_ID);
    url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("scope", "read:org");
    url.searchParams.set("state", state);
    return reply.redirect(url.toString());
  });

  app.get("/api/auth/github/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string };
    const expected = req.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: "/api/auth" });
    if (!q.code || !q.state || !expected || q.state !== expected) {
      throw new ApiError(400, "OAUTH_STATE", "invalid OAuth state");
    }

    const tokenRes = await fetch(GITHUB_TOKEN, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.GITHUB_CLIENT_ID,
        client_secret: config.GITHUB_CLIENT_SECRET,
        code: q.code,
        redirect_uri: callbackUrl,
      }),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) {
      throw new ApiError(502, "OAUTH_FAILED", "GitHub token exchange failed");
    }
    const gh = token.access_token;

    const ghUser = (await ghFetch(`${GITHUB_API}/user`, gh)) as {
      id: number;
      login: string;
      avatar_url: string;
    };

    // Allowlist: explicit logins, or any member of the allowed org.
    const allowedLogins = allowedUserLogins(config);
    let allowed = allowedLogins.has(ghUser.login.toLowerCase());
    if (!allowed && config.ALLOWED_GITHUB_ORG) {
      const orgs = (await ghFetch(`${GITHUB_API}/user/orgs?per_page=100`, gh)) as {
        login: string;
      }[];
      allowed = orgs.some(
        (o) => o.login.toLowerCase() === config.ALLOWED_GITHUB_ORG!.toLowerCase(),
      );
    }
    if (!allowed) {
      audit(db, {
        action: "login.denied",
        userLogin: ghUser.login,
        ip: req.ip,
        detail: "not in allowlist",
      });
      return reply.redirect("/?denied=1");
    }

    // Upsert user; discard the GitHub token (never stored).
    const existing = db
      .prepare("SELECT id FROM users WHERE github_id = ?")
      .get(ghUser.id) as { id: number } | undefined;
    let userId: number;
    if (existing) {
      userId = existing.id;
      db.prepare(
        "UPDATE users SET login = ?, avatar_url = ?, last_login_at = datetime('now') WHERE id = ?",
      ).run(ghUser.login, ghUser.avatar_url, userId);
    } else {
      const r = db
        .prepare(
          `INSERT INTO users (github_id, login, avatar_url, role, last_login_at)
           VALUES (?, ?, ?, 'editor', datetime('now'))`,
        )
        .run(ghUser.id, ghUser.login, ghUser.avatar_url);
      userId = Number(r.lastInsertRowid);
    }

    const sid = createSession(db, userId, req.ip, req.headers["user-agent"] ?? "");
    reply.setCookie(SESSION_COOKIE, sid, {
      path: "/",
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: 12 * 60 * 60,
    });
    reply.setCookie(CSRF_COOKIE, randomBytes(32).toString("hex"), {
      path: "/",
      httpOnly: false,
      secure,
      sameSite: "lax",
      maxAge: 12 * 60 * 60,
    });
    audit(db, { action: "login.success", userLogin: ghUser.login, ip: req.ip });
    return reply.redirect("/");
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) destroySession(db, sid);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.clearCookie(CSRF_COOKIE, { path: "/" });
    return { ok: true };
  });
}

async function ghFetch(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ferry",
    },
  });
  if (!res.ok) throw new ApiError(502, "GITHUB_API", `GitHub API ${res.status}`);
  return res.json();
}

/** Dev-only login bypass for Playwright — registered only when NODE_ENV=test. */
export function testAuthRoutes(app: FastifyInstance, db: Database.Database) {
  const upsert = (login: string, role?: string) => {
    const ghId = Math.abs(
      [...login].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7),
    );
    let row = db.prepare("SELECT id FROM users WHERE login = ?").get(login) as
      | { id: number }
      | undefined;
    if (!row) {
      const r = db
        .prepare(
          "INSERT INTO users (github_id, login, role) VALUES (?, ?, ?)",
        )
        .run(ghId, login, role === "viewer" ? "viewer" : "editor");
      row = { id: Number(r.lastInsertRowid) };
    }
    return row.id;
  };

  app.post("/api/auth/test", async (req) => {
    const { login, role } = req.body as { login: string; role?: string };
    const sid = createSession(
      db,
      upsert(login, role),
      "127.0.0.1",
      "playwright",
    );
    return { sessionId: sid };
  });

  // Clickable dev login: /api/auth/test?login=demo → sets cookies, redirects to /
  app.get("/api/auth/test", async (req, reply) => {
    const { login = "dev", role } = req.query as {
      login?: string;
      role?: string;
    };
    const sid = createSession(db, upsert(login, role), "127.0.0.1", "dev");
    reply.setCookie(SESSION_COOKIE, sid, {
      path: "/",
      httpOnly: true,
      secure: true, // localhost counts as a secure context in Chrome/Firefox
      sameSite: "lax",
      maxAge: 12 * 60 * 60,
    });
    reply.setCookie(CSRF_COOKIE, randomBytes(32).toString("hex"), {
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      maxAge: 12 * 60 * 60,
    });
    return reply.redirect("/");
  });
}
