import type { FastifyInstance } from "fastify";
import type { Ctx } from "../ctx.js";
import { copySchema, importSchema, parseEnv, serializeEnv } from "@ferry/shared";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { user } from "../guard.js";
import { envParams } from "./keys.js";

type KeyStatus = "new" | "changed" | "unchanged" | "removed";

function classify(
  parsed: Map<string, string>,
  existing: Map<string, string>,
  replace: boolean,
): { key: string; status: KeyStatus }[] {
  const rows: { key: string; status: KeyStatus }[] = [];
  for (const [key, value] of parsed) {
    rows.push({
      key,
      status: !existing.has(key)
        ? "new"
        : existing.get(key) === value
          ? "unchanged"
          : "changed",
    });
  }
  if (replace) {
    for (const key of existing.keys()) {
      if (!parsed.has(key)) rows.push({ key, status: "removed" });
    }
  }
  return rows;
}

export function envioRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, guard, params } = ctx;
  const viewer = guard.requireRole("viewer");
  const editor = guard.requireRole("editor");
  const write = [editor, guard.envWriteGuard];

  app.post(
    "/api/projects/:project/envs/:env/import/preview",
    { preHandler: [editor] },
    async (req) => {
      const { project, env } = envParams(req);
      const body = importSchema.parse(req.body ?? {});
      const parsed = parseEnv(body.text);
      const existing = await params.getAllValues(project, env);
      const parsedMap = new Map(parsed.entries.map((e) => [e.key, e.value]));
      return {
        rows: classify(parsedMap, existing, body.replace),
        duplicates: parsed.duplicates,
        warnings: parsed.warnings,
      };
    },
  );

  app.post(
    "/api/projects/:project/envs/:env/import",
    { preHandler: write },
    async (req) => {
      const { project, env } = envParams(req);
      const body = importSchema.parse(req.body ?? {});
      const parsed = parseEnv(body.text);
      const parsedMap = new Map(parsed.entries.map((e) => [e.key, e.value]));

      const results = await params.putMany(
        project,
        env,
        parsed.entries.filter((e) => e.value !== ""),
      );
      const skipped = parsed.entries
        .filter((e) => e.value === "")
        .map((e) => e.key);

      let removed: string[] = [];
      if (body.replace) {
        const existing = await params.getAllValues(project, env);
        removed = [...existing.keys()].filter((k) => !parsedMap.has(k));
        if (removed.length) await params.deleteMany(project, env, removed);
      }

      audit(db, {
        action: "env.import",
        userLogin: user(req).login,
        ip: req.ip,
        project,
        environment: env,
        detail: `${results.filter((r) => r.ok).length} written, ${removed.length} removed`,
      });
      return {
        results,
        skipped,
        removed,
        warnings: parsed.warnings,
        duplicates: parsed.duplicates,
      };
    },
  );

  app.get(
    "/api/projects/:project/envs/:env/export",
    { preHandler: [editor] },
    async (req, reply) => {
      const { project, env } = envParams(req);
      const values = await params.getAllValues(project, env);
      const entries = [...values.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => ({ key, value }));
      const text = serializeEnv(entries);
      audit(db, { action: "env.export", userLogin: user(req).login, ip: req.ip, project, environment: env });
      return reply
        .headers({
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="${project}.${env}.env"`,
          "cache-control": "no-store",
        })
        .send(text);
    },
  );

  app.post(
    "/api/projects/:project/envs/:env/copy",
    { preHandler: write },
    async (req) => {
      const { project, env } = envParams(req);
      const body = copySchema.parse(req.body ?? {});

      const targetExists = db
        .prepare("SELECT 1 FROM environments WHERE project = ? AND name = ?")
        .get(project, body.to);
      if (!targetExists) throw notFound("target environment not found");

      const values = await params.getAllValues(project, env);
      if (!body.includeValues) {
        // Keys-only: nothing is written — the client opens a draft import.
        return {
          keys: [...values.keys()].sort(),
          copied: 0,
        };
      }
      const results = await params.putMany(
        project,
        body.to,
        [...values.entries()].map(([key, value]) => ({ key, value })),
      );
      audit(db, {
        action: "env.copy",
        userLogin: user(req).login,
        ip: req.ip,
        project,
        environment: env,
        detail: `→ ${body.to}, ${results.filter((r) => r.ok).length} keys`,
      });
      return {
        results,
        copied: results.filter((r) => r.ok).length,
      };
    },
  );

  app.get(
    "/api/projects/:project/diff",
    { preHandler: [viewer] },
    async (req) => {
      const { project } = envParams(req);
      const { a, b } = req.query as { a?: string; b?: string };
      if (!a || !b) throw badRequest("DIFF_PARAMS", "a and b are required");
      const [va, vb] = await Promise.all([
        params.getAllValues(project, a),
        params.getAllValues(project, b),
      ]);
      const keys = [...new Set([...va.keys(), ...vb.keys()])].sort();
      const rows = keys.map((key) => ({
        key,
        status: !va.has(key)
          ? "only_in_b"
          : !vb.has(key)
            ? "only_in_a"
            : va.get(key) === vb.get(key)
              ? "same"
              : "different",
      }));
      return { a, b, rows };
    },
  );
}
