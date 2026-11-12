import type { FastifyInstance } from "fastify";
import type { Ctx } from "../ctx.js";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";
import { destroyUserSessions } from "../lib/session.js";
import { user } from "../guard.js";

const patchSchema = z.object({
  role: z.enum(["viewer", "editor"]).optional(),
  restricted: z.boolean().optional(),
});

export function userRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, guard } = ctx;
  const admin = guard.requireRole("admin");

  app.get("/api/users", { preHandler: [admin] }, async () => {
    const rows = db
      .prepare(
        `SELECT id, github_id, login, avatar_url, role, restricted, created_at, last_login_at
         FROM users ORDER BY login`,
      )
      .all() as Record<string, unknown>[];
    return {
      users: rows.map((r) => ({ ...r, restricted: r.restricted === 1 })),
    };
  });

  app.patch("/api/users/:id", { preHandler: [admin] }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = patchSchema.parse(req.body ?? {});
    const target = db.prepare("SELECT id, login FROM users WHERE id = ?").get(id) as
      | { id: number; login: string }
      | undefined;
    if (!target) throw notFound("user not found");
    if (body.role) {
      db.prepare("UPDATE users SET role = ? WHERE id = ?").run(body.role, id);
    }
    if (body.restricted !== undefined) {
      db.prepare("UPDATE users SET restricted = ? WHERE id = ?").run(
        body.restricted ? 1 : 0,
        id,
      );
    }
    audit(db, { action: "user.update", userLogin: user(req).login, ip: req.ip, detail: `${target.login}: ${JSON.stringify(body)}` });
    return { ok: true };
  });

  app.post("/api/users/:id/revoke", { preHandler: [admin] }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    destroyUserSessions(db, id);
    audit(db, { action: "user.revoke_sessions", userLogin: user(req).login, ip: req.ip, detail: `user ${id}` });
    return { ok: true };
  });
}
