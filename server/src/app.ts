import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { SSMClient } from "@aws-sdk/client-ssm";
import { IAMClient } from "@aws-sdk/client-iam";
import { STSClient } from "@aws-sdk/client-sts";
import type Database from "better-sqlite3";
import { ZodError } from "zod";
import type { Config } from "@ferry/shared";
import type { Ctx } from "./ctx.js";
import { makeGuard } from "./guard.js";
import { registerHooks } from "./hooks.js";
import { ApiError } from "./lib/errors.js";
import { GithubSetupService } from "./lib/githubSetupService.js";
import { ParameterService } from "./lib/parameterService.js";
import { RateLimiter } from "./lib/rateLimit.js";
import { authRoutes, testAuthRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { setupRoutes } from "./routes/setup.js";
import { projectRoutes } from "./routes/projects.js";
import { keyRoutes } from "./routes/keys.js";
import { envioRoutes } from "./routes/envio.js";
import { githubRoutes } from "./routes/github.js";
import { auditRoutes } from "./routes/audit.js";
import { userRoutes } from "./routes/users.js";
import { snippetsRoutes } from "./routes/snippets.js";
import { miscRoutes } from "./routes/misc.js";

export interface BuildOptions {
  config: Config;
  db: Database.Database;
  ssm?: SSMClient;
  iam?: IAMClient;
  sts?: STSClient;
  staticDir?: string;
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { config, db, staticDir } = opts;
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'req.body.value',
          'req.body.values',
          'req.body.text',
        ],
        censor: "[redacted]",
      },
    },
    trustProxy: config.TRUST_PROXY === "true",
  });

  await app.register(cookie);

  const ssm = opts.ssm ?? new SSMClient({ region: config.AWS_REGION });
  const iam = opts.iam ?? new IAMClient({ region: config.AWS_REGION });
  const sts = opts.sts ?? new STSClient({ region: config.AWS_REGION });

  const ctx: Ctx = {
    db,
    config,
    params: new ParameterService(ssm, config.FERRY_PREFIX, config.KMS_KEY_ID),
    github: new GithubSetupService(db, iam, sts, config.FERRY_PREFIX, config.AWS_REGION),
    guard: makeGuard(db, config),
  };

  const limiter = new RateLimiter();
  setInterval(() => limiter.sweep(10 * 60_000), 60_000).unref();
  registerHooks(app, config, limiter);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION",
          message: err.issues.map((i) => i.message).join("; "),
        },
      });
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) {
      return reply.code(statusCode).send({
        error: {
          code: "REQUEST_ERROR",
          message: err instanceof Error ? err.message : "request error",
        },
      });
    }
    req.log.error(err);
    return reply
      .code(500)
      .send({ error: { code: "INTERNAL", message: "internal error" } });
  });

  // Routes
  miscRoutes(app);
  authRoutes(app, db, config);
  if (process.env.NODE_ENV === "test") testAuthRoutes(app, db);
  meRoutes(app, ctx);
  setupRoutes(app, ctx);
  projectRoutes(app, ctx);
  keyRoutes(app, ctx);
  envioRoutes(app, ctx);
  githubRoutes(app, ctx);
  auditRoutes(app, ctx);
  userRoutes(app, ctx);
  snippetsRoutes(app, ctx);

  // Static SPA + API 404 / SPA fallback
  if (staticDir && existsSync(staticDir)) {
    await app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
    });
  }
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply
        .code(404)
        .send({ error: { code: "NOT_FOUND", message: "not found" } });
    }
    if (req.method === "GET" && staticDir && existsSync(join(staticDir, "index.html"))) {
      const html = await readFile(join(staticDir, "index.html"), "utf8");
      return reply
        .headers({ "content-type": "text/html", "cache-control": "no-cache" })
        .send(html);
    }
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "not found" } });
  });

  return app;
}
