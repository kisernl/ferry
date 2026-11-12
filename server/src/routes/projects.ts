import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx } from "../ctx.js";
import {
  envCreateSchema,
  envPatchSchema,
  isValidSlug,
  projectCreateSchema,
} from "@ferry/shared";
import { protectedEnvDefaults } from "../config.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { rescan } from "../lib/rescan.js";
import { user } from "../guard.js";

function slugParam(req: FastifyRequest, name: string): string {
  const v = (req.params as Record<string, string>)[name]!;
  if (!isValidSlug(v)) throw badRequest("SLUG_INVALID", `invalid ${name}`);
  return v;
}

export function projectRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, guard, params } = ctx;
  const admin = guard.requireRole("admin");
  const viewer = guard.requireRole("viewer");

  app.get("/api/projects", { preHandler: [viewer] }, async () => {
    const projects = db
      .prepare("SELECT name, created_at FROM projects ORDER BY display_order, name")
      .all() as { name: string; created_at: string }[];
    const envs = db
      .prepare(
        "SELECT project, name, protected FROM environments ORDER BY display_order, name",
      )
      .all() as { project: string; name: string; protected: number }[];

    const out = [];
    for (const p of projects) {
      const envList = [];
      for (const e of envs.filter((x) => x.project === p.name)) {
        const keys = await params.listEnv(p.name, e.name);
        envList.push({
          name: e.name,
          protected: e.protected === 1,
          keyCount: keys.length,
          lastModified:
            keys.map((k) => k.lastModified).filter(Boolean).sort().pop() ?? null,
        });
      }
      out.push({ name: p.name, createdAt: p.created_at, environments: envList });
    }
    return { projects: out };
  });

  app.post("/api/projects", { preHandler: [admin] }, async (req) => {
    const body = projectCreateSchema.parse(req.body ?? {});
    const defaults = protectedEnvDefaults(ctx.config);
    db.transaction(() => {
      db.prepare("INSERT INTO projects (name) VALUES (?)").run(body.name);
      const ins = db.prepare(
        "INSERT INTO environments (project, name, protected, display_order) VALUES (?, ?, ?, ?)",
      );
      body.environments.forEach((env, i) =>
        ins.run(body.name, env, defaults.has(env) ? 1 : 0, i),
      );
    })();
    audit(db, { action: "project.create", userLogin: user(req).login, ip: req.ip, project: body.name });
    return { ok: true };
  });

  app.delete("/api/projects/:project", { preHandler: [admin] }, async (req) => {
    const project = slugParam(req, "project");
    const force = (req.query as { force?: string }).force === "true";
    if (!db.prepare("SELECT 1 FROM projects WHERE name = ?").get(project)) {
      throw notFound("project not found");
    }
    const keys = await params.listNamesUnder(`/${ctx.config.FERRY_PREFIX}/${project}/`);
    if (keys.length > 0 && !force) {
      throw badRequest(
        "NOT_EMPTY",
        `project has ${keys.length} keys; pass ?force=true to delete them first`,
      );
    }
    if (force && keys.length > 0) {
      await params.deleteAllUnder(`/${ctx.config.FERRY_PREFIX}/${project}/`);
    }
    db.prepare("DELETE FROM projects WHERE name = ?").run(project);
    audit(db, {
      action: "project.delete",
      userLogin: user(req).login,
      ip: req.ip,
      project,
      detail: force ? `force, ${keys.length} keys deleted` : null,
    });
    return { ok: true };
  });

  app.post("/api/projects/:project/envs", { preHandler: [admin] }, async (req) => {
    const project = slugParam(req, "project");
    if (!db.prepare("SELECT 1 FROM projects WHERE name = ?").get(project)) {
      throw notFound("project not found");
    }
    const body = envCreateSchema.parse(req.body ?? {});
    db.prepare(
      "INSERT INTO environments (project, name, protected) VALUES (?, ?, ?)",
    ).run(project, body.name, body.protected ? 1 : 0);
    audit(db, { action: "env.create", userLogin: user(req).login, ip: req.ip, project, environment: body.name });
    return { ok: true };
  });

  app.patch("/api/projects/:project/envs/:env", { preHandler: [admin] }, async (req) => {
    const project = slugParam(req, "project");
    const env = slugParam(req, "env");
    const body = envPatchSchema.parse(req.body ?? {});
    const r = db
      .prepare(
        "UPDATE environments SET protected = ? WHERE project = ? AND name = ?",
      )
      .run(body.protected ? 1 : 0, project, env);
    if (r.changes === 0) throw notFound("environment not found");
    audit(db, { action: "env.protect", userLogin: user(req).login, ip: req.ip, project, environment: env, detail: String(body.protected) });
    return { ok: true };
  });

  app.delete("/api/projects/:project/envs/:env", { preHandler: [admin] }, async (req) => {
    const project = slugParam(req, "project");
    const env = slugParam(req, "env");
    const force = (req.query as { force?: string }).force === "true";
    if (!db.prepare("SELECT 1 FROM environments WHERE project = ? AND name = ?").get(project, env)) {
      throw notFound("environment not found");
    }
    const keys = await params.listNamesUnder(
      `/${ctx.config.FERRY_PREFIX}/${project}/${env}/`,
    );
    if (keys.length > 0 && !force) {
      throw badRequest(
        "NOT_EMPTY",
        `environment has ${keys.length} keys; pass ?force=true to delete them first`,
      );
    }
    if (force && keys.length > 0) {
      await params.deleteAllUnder(`/${ctx.config.FERRY_PREFIX}/${project}/${env}/`);
    }
    db.prepare("DELETE FROM environments WHERE project = ? AND name = ?").run(project, env);
    audit(db, {
      action: "env.delete",
      userLogin: user(req).login,
      ip: req.ip,
      project,
      environment: env,
      detail: force ? `force, ${keys.length} keys deleted` : null,
    });
    return { ok: true };
  });

  app.post("/api/rescan", { preHandler: [admin] }, async (req) => {
    const result = await rescan(db, params, protectedEnvDefaults(ctx.config));
    audit(db, { action: "aws.rescan", userLogin: user(req).login, ip: req.ip, detail: `${result.added.length} added` });
    return result;
  });
}
