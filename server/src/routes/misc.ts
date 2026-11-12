import type { FastifyInstance } from "fastify";

export function miscRoutes(app: FastifyInstance) {
  app.get("/api/healthz", async () => ({ ok: true }));
}
