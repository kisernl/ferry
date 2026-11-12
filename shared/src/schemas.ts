import { z } from "zod";
import { KEY_RE, SLUG_RE } from "./validate.js";

/** Request-body schemas shared by the client forms and the Fastify routes. */

export const slugSchema = z
  .string()
  .regex(SLUG_RE, "lowercase slug: [a-z0-9][a-z0-9-]{0,62}");

export const keySchema = z
  .string()
  .regex(KEY_RE, "env var name: [A-Za-z_][A-Za-z0-9_]{0,254}");

export const projectCreateSchema = z.object({
  name: slugSchema,
  environments: z.array(slugSchema).min(1).default(["development", "staging", "production"]),
});

export const envCreateSchema = z.object({
  name: slugSchema,
  protected: z.boolean().default(false),
});

export const envPatchSchema = z.object({
  protected: z.boolean(),
});

export const keyPutSchema = z.object({
  value: z.string().min(1, "empty values are not allowed").max(4096, "value exceeds 4KB"),
  description: z.string().max(1024).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const importSchema = z.object({
  text: z.string().max(1024 * 1024),
  replace: z.boolean().default(false),
});

export const copySchema = z.object({
  to: slugSchema,
  includeValues: z.boolean(),
});

export const restoreSchema = z.object({
  version: z.number().int().positive(),
});

export const ownerCreateSchema = z.object({
  owner: z.string().regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/, "GitHub owner name"),
  mode: z.enum(["all", "selected"]),
});

export const ownerPatchSchema = z.object({
  mode: z.enum(["all", "selected"]),
});

export const repoAddSchema = z.object({
  repo: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, "owner/repo"),
  projects: z.array(slugSchema).min(1),
});

/** Server configuration, validated from process.env at startup. */
export const configSchema = z
  .object({
    PUBLIC_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be 32+ chars"),
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    ALLOWED_GITHUB_USERS: z.string().optional(),
    ALLOWED_GITHUB_ORG: z.string().optional(),
    ADMIN_GITHUB_USERS: z.string().min(1),
    AWS_REGION: z.string().min(1),
    FERRY_PREFIX: slugSchema.default("ferry"),
    KMS_KEY_ID: z.string().optional(),
    PROTECTED_ENVS: z.string().default("production"),
    DATA_DIR: z.string().default("/data"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  })
  .refine((d) => d.ALLOWED_GITHUB_USERS || d.ALLOWED_GITHUB_ORG, {
    message: "ALLOWED_GITHUB_USERS or ALLOWED_GITHUB_ORG is required",
  })
  .refine(
    (d) =>
      d.PUBLIC_URL.startsWith("https://") ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(d.PUBLIC_URL),
    { message: "PUBLIC_URL must be https:// (http only allowed for localhost)" },
  );

export type Config = z.infer<typeof configSchema>;
