import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "@ferry/shared";
import { ApiError } from "./lib/errors.js";
import type { RateLimiter } from "./lib/rateLimit.js";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "./lib/session.js";

const MINUTE = 60_000;
const REVEAL_RE = /^\/api\/projects\/[^/]+\/envs\/[^/]+\/keys\/[^/]+$/;

function rateLimited(
  limiter: RateLimiter,
  bucket: string,
  limit: number,
): void {
  if (!limiter.allow(bucket, limit, MINUTE)) {
    throw new ApiError(429, "RATE_LIMITED", "too many requests");
  }
}

export function registerHooks(
  app: FastifyInstance,
  config: Config,
  limiter: RateLimiter,
): void {
  app.addHook("onRequest", async (req, reply) => {
    // Plain-HTTP requests behind the proxy get bounced to https.
    if (
      config.TRUST_PROXY === "true" &&
      config.PUBLIC_URL.startsWith("https://") &&
      req.headers["x-forwarded-proto"] === "http"
    ) {
      return reply
        .code(301)
        .redirect(config.PUBLIC_URL.replace(/\/$/, "") + req.raw.url);
    }

    reply.headers(securityHeaders());

    // Rate limits: login attempts per IP, then per-route buckets.
    if (req.url.startsWith("/api/auth/")) {
      rateLimited(limiter, `login:${req.ip}`, 10);
    }
    if (req.method === "POST" && req.url === "/api/setup/check") {
      rateLimited(limiter, `setup:${req.ip}`, 2);
    }
    if (req.method === "GET" && REVEAL_RE.test(req.url)) {
      const sid = req.cookies?.[SESSION_COOKIE] ?? req.ip;
      rateLimited(limiter, `reveal:${sid}`, 30);
    }
    if (req.url.startsWith("/api/") && req.method !== "GET") {
      const sid = req.cookies?.[SESSION_COOKIE] ?? req.ip;
      rateLimited(limiter, `api:${sid}`, 120);
    }

    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      req.url.startsWith("/api/")
    ) {
      // Double-submit CSRF token on every state-changing request.
      // (Auth routes are exempt — they're protected by the OAuth state cookie.)
      if (!req.url.startsWith("/api/auth/")) {
        const cookie = req.cookies?.[CSRF_COOKIE];
        const header = req.headers[CSRF_HEADER];
        if (!cookie || cookie !== header) {
          throw new ApiError(403, "CSRF", "missing or invalid CSRF token");
        }
      }
      // Non-GET bodies must be JSON.
      const len = Number(req.headers["content-length"] ?? 0);
      const ct = String(req.headers["content-type"] ?? "");
      if ((len > 0 || req.headers["transfer-encoding"]) && !ct.includes("application/json")) {
        throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "bodies must be application/json");
      }
    }
  });
}

function securityHeaders(): Record<string, string> {
  return {
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
  };
}
