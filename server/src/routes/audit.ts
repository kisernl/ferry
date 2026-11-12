import type { FastifyInstance } from "fastify";
import type { Ctx } from "../ctx.js";

const PAGE_SIZE = 100;

export function auditRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, guard } = ctx;

  app.get("/api/audit", { preHandler: [guard.requireRole("admin")] }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.user) { where.push("user_login = ?"); args.push(q.user); }
    if (q.project) { where.push("project = ?"); args.push(q.project); }
    if (q.action) { where.push("action = ?"); args.push(q.action); }
    if (q.from) { where.push("ts >= ?"); args.push(q.from); }
    if (q.to) { where.push("ts <= ?"); args.push(q.to); }
    const cond = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const page = Math.max(1, Number(q.page ?? 1));

    const total = (
      db.prepare(`SELECT COUNT(*) c FROM audit_log ${cond}`).get(...args) as {
        c: number;
      }
    ).c;

    if (q.format === "csv") {
      const rows = db
        .prepare(`SELECT * FROM audit_log ${cond} ORDER BY ts DESC`)
        .all(...args) as Record<string, unknown>[];
      const header = "id,ts,user_login,ip,action,project,environment,key_name,detail";
      const csv = [
        header,
        ...rows.map((r) =>
          [r.id, r.ts, r.user_login, r.ip, r.action, r.project, r.environment, r.key_name, r.detail]
            .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
            .join(","),
        ),
      ].join("\n");
      return reply
        .headers({
          "content-type": "text/csv",
          "content-disposition": 'attachment; filename="ferry-audit.csv"',
        })
        .send(csv);
    }

    const rows = db
      .prepare(
        `SELECT * FROM audit_log ${cond} ORDER BY ts DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    return { rows, total, page, pageSize: PAGE_SIZE };
  });
}
