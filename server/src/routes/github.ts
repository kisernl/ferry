import type { FastifyInstance } from "fastify";
import type { Ctx } from "../ctx.js";
import {
  buildSetupScript,
  ownerCreateSchema,
  ownerPatchSchema,
  repoAddSchema,
} from "@ferry/shared";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { user } from "../guard.js";

export function githubRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, guard, github } = ctx;
  const admin = guard.requireRole("admin");

  async function state() {
    const roles = await github.roles();
    return {
      owners: github.owners(),
      repos: github.repos(),
      roles: roles.map((r) => ({
        name: r.name,
        env: r.env,
        project: r.project,
        trustPolicy: r.trustPolicy,
        readPolicy: r.readPolicy,
      })),
      script: buildSetupScript(roles),
    };
  }

  app.get("/api/github/owners", { preHandler: [admin] }, async () => state());

  app.post("/api/github/owners", { preHandler: [admin] }, async (req) => {
    const body = ownerCreateSchema.parse(req.body ?? {});
    db.prepare("INSERT OR REPLACE INTO github_owners (owner, mode) VALUES (?, ?)").run(
      body.owner,
      body.mode,
    );
    audit(db, { action: "github.owner.create", userLogin: user(req).login, ip: req.ip, detail: `${body.owner} (${body.mode})` });
    return state();
  });

  app.delete("/api/github/owners/:owner", { preHandler: [admin] }, async (req) => {
    const { owner } = req.params as { owner: string };
    const before = await github.roles();
    const r = db.prepare("DELETE FROM github_owners WHERE owner = ?").run(owner);
    db.prepare("DELETE FROM github_repos WHERE owner = ?").run(owner);
    if (r.changes === 0) throw notFound("owner not found");
    const after = await github.roles();
    const removed = before
      .filter((b) => !after.some((a) => a.name === b.name))
      .map((b) => b.name);
    audit(db, { action: "github.owner.delete", userLogin: user(req).login, ip: req.ip, detail: owner });
    return {
      ...(await state()),
      cleanupScript: removed.map((n) => github.deleteRoleScript(n)).join("\n"),
    };
  });

  app.patch("/api/github/owners/:owner", { preHandler: [admin] }, async (req) => {
    const { owner } = req.params as { owner: string };
    const body = ownerPatchSchema.parse(req.body ?? {});
    const r = db.prepare("UPDATE github_owners SET mode = ? WHERE owner = ?").run(body.mode, owner);
    if (r.changes === 0) throw notFound("owner not found");
    audit(db, { action: "github.owner.mode", userLogin: user(req).login, ip: req.ip, detail: `${owner} → ${body.mode}` });
    return state();
  });

  app.post("/api/github/repos", { preHandler: [admin] }, async (req) => {
    const body = repoAddSchema.parse(req.body ?? {});
    const [owner, repo] = body.repo.split("/") as [string, string];
    const ownerRow = db
      .prepare("SELECT mode FROM github_owners WHERE owner = ?")
      .get(owner) as { mode: string } | undefined;
    if (!ownerRow) throw badRequest("OWNER_MISSING", `connect owner "${owner}" first`);
    if (ownerRow.mode !== "selected") {
      throw badRequest("OWNER_NOT_SELECTED", `owner "${owner}" is in All repos mode; repo assignment is not needed`);
    }
    const ins = db.prepare(
      "INSERT OR IGNORE INTO github_repos (owner, repo, project) VALUES (?, ?, ?)",
    );
    db.transaction(() => {
      for (const project of body.projects) ins.run(owner, repo, project);
    })();
    audit(db, { action: "github.repo.add", userLogin: user(req).login, ip: req.ip, detail: `${body.repo} → ${body.projects.join(",")}` });
    return state();
  });

  app.delete("/api/github/repos/:owner/:repo", { preHandler: [admin] }, async (req) => {
    const { owner, repo } = req.params as { owner: string; repo: string };
    const q = req.query as { project?: string };
    if (q.project) {
      db.prepare(
        "DELETE FROM github_repos WHERE owner = ? AND repo = ? AND project = ?",
      ).run(owner, repo, q.project);
    } else {
      db.prepare("DELETE FROM github_repos WHERE owner = ? AND repo = ?").run(owner, repo);
    }
    audit(db, { action: "github.repo.remove", userLogin: user(req).login, ip: req.ip, detail: `${owner}/${repo}` });
    return state();
  });

  app.get("/api/github/setup", { preHandler: [admin] }, async () => state());

  app.post("/api/github/check", { preHandler: [admin] }, async (req) => {
    const result = await github.check();
    audit(db, { action: "github.check", userLogin: user(req).login, ip: req.ip });
    return result;
  });
}
