import type { FastifyInstance } from "fastify";
import type { Ctx } from "../ctx.js";
import { user } from "../guard.js";

export function meRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get(
    "/api/me",
    { preHandler: [ctx.guard.requireAuth] },
    async (req) => {
      const u = user(req);
      return {
        login: u.login,
        avatarUrl: u.avatarUrl,
        role: u.effectiveRole,
        restricted: u.restricted,
      };
    },
  );
}
