import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Ctx } from "../ctx.js";
import { isValidKey, isValidSlug, keyPutSchema, restoreSchema } from "@ferry/shared";
import { audit } from "../lib/audit.js";
import { badRequest } from "../lib/errors.js";
import { user } from "../guard.js";

export function envParams(req: FastifyRequest): { project: string; env: string } {
  const { project, env } = req.params as { project: string; env: string };
  if (!isValidSlug(project)) throw badRequest("SLUG_INVALID", "invalid project");
  if (!isValidSlug(env)) throw badRequest("SLUG_INVALID", "invalid environment");
  return { project, env };
}

export function keyParam(req: FastifyRequest): string {
  const { key } = req.params as { key: string };
  if (!isValidKey(key)) throw badRequest("KEY_INVALID", "invalid key name");
  return key;
}

export function keyRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, guard, params } = ctx;
  const viewer = guard.requireRole("viewer");
  const editor = guard.requireRole("editor");
  const write = [editor, guard.envWriteGuard];

  const noStore = { "cache-control": "no-store" };

  app.get(
    "/api/projects/:project/envs/:env/keys",
    { preHandler: [viewer] },
    async (req) => {
      const { project, env } = envParams(req);
      return { keys: await params.listEnv(project, env) };
    },
  );

  app.get(
    "/api/projects/:project/envs/:env/keys/:key",
    { preHandler: [editor] },
    async (req, reply) => {
      const { project, env } = envParams(req);
      const key = keyParam(req);
      const res = await params.reveal(project, env, key);
      audit(db, { action: "key.reveal", userLogin: user(req).login, ip: req.ip, project, environment: env, key });
      return reply.headers(noStore).send(res);
    },
  );

  app.put(
    "/api/projects/:project/envs/:env/keys/:key",
    { preHandler: write },
    async (req) => {
      const { project, env } = envParams(req);
      const key = keyParam(req);
      const body = keyPutSchema.parse(req.body ?? {});
      const res = await params.put(project, env, key, body.value, {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.expectedVersion !== undefined
          ? { expectedVersion: body.expectedVersion }
          : {}),
        tags: {
          "managed-by": "ferry",
          "ferry-project": project,
          "ferry-env": env,
        },
      });
      audit(db, { action: "key.put", userLogin: user(req).login, ip: req.ip, project, environment: env, key });
      return res;
    },
  );

  app.delete(
    "/api/projects/:project/envs/:env/keys/:key",
    { preHandler: write },
    async (req) => {
      const { project, env } = envParams(req);
      const key = keyParam(req);
      await params.delete(project, env, key);
      audit(db, { action: "key.delete", userLogin: user(req).login, ip: req.ip, project, environment: env, key });
      return { ok: true };
    },
  );

  app.get(
    "/api/projects/:project/envs/:env/keys/:key/history",
    { preHandler: [viewer] },
    async (req) => {
      const { project, env } = envParams(req);
      const key = keyParam(req);
      return { versions: await params.history(project, env, key) };
    },
  );

  app.get(
    "/api/projects/:project/envs/:env/keys/:key/history/:version",
    { preHandler: [editor] },
    async (req, reply) => {
      const { project, env } = envParams(req);
      const key = keyParam(req);
      const version = Number((req.params as { version: string }).version);
      if (!Number.isInteger(version) || version < 1) {
        throw badRequest("VERSION_INVALID", "invalid version");
      }
      const value = await params.revealVersion(project, env, key, version);
      audit(db, { action: "key.reveal", userLogin: user(req).login, ip: req.ip, project, environment: env, key, detail: `version ${version}` });
      return reply.headers(noStore).send({ value, version });
    },
  );

  app.post(
    "/api/projects/:project/envs/:env/keys/:key/restore",
    { preHandler: write },
    async (req) => {
      const { project, env } = envParams(req);
      const key = keyParam(req);
      const body = restoreSchema.parse(req.body ?? {});
      const value = await params.revealVersion(project, env, key, body.version);
      const res = await params.put(project, env, key, value, {
        tags: {
          "managed-by": "ferry",
          "ferry-project": project,
          "ferry-env": env,
        },
      });
      audit(db, { action: "key.restore", userLogin: user(req).login, ip: req.ip, project, environment: env, key, detail: `restored v${body.version}` });
      return res;
    },
  );
}
