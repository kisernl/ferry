import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockClient } from "aws-sdk-client-mock";
import {
  DescribeParametersCommand,
  GetParameterCommand,
  PutParameterCommand,
  DeleteParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";
import { IAMClient } from "@aws-sdk/client-iam";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import type { FastifyInstance } from "fastify";
import { configSchema } from "@ferry/shared";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";

process.env.NODE_ENV = "test";

const dir = mkdtempSync(join(tmpdir(), "ferry-test-"));
const db = openDb(dir);
const ssm = new SSMClient({ region: "us-east-1" });
const iam = new IAMClient({ region: "us-east-1" });
const sts = new STSClient({ region: "us-east-1" });
const ssmMock = mockClient(ssm);
mockClient(iam);
const stsMock = mockClient(sts);

const config = configSchema.parse({
  PUBLIC_URL: "http://localhost:3000",
  SESSION_SECRET: "x".repeat(40),
  GITHUB_CLIENT_ID: "id",
  GITHUB_CLIENT_SECRET: "secret",
  ALLOWED_GITHUB_USERS: "admin,viewer",
  ADMIN_GITHUB_USERS: "admin",
  AWS_REGION: "us-east-1",
});

let app: FastifyInstance;
let session: string;

const CSRF = "test-csrf-token";
const authed = () => ({
  cookie: `__Host-ferry-session=${session}; ferry-csrf=${CSRF}`,
});
const write = () => ({
  ...authed(),
  "x-csrf-token": CSRF,
  "content-type": "application/json",
});

beforeAll(async () => {
  app = await buildApp({ config, db, ssm, iam, sts });
  stsMock.on(GetCallerIdentityCommand).resolves({
    Account: "123456789012",
    Arn: "arn:aws:iam::123456789012:role/ferry",
  });
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/test",
    payload: { login: "admin" },
  });
  session = (res.json() as { sessionId: string }).sessionId;
});

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("auth + guard", () => {
  it("healthz is open", async () => {
    const res = await app.inject({ method: "GET", url: "/api/healthz" });
    expect(res.statusCode).toBe(200);
  });

  it("rejects unauthenticated API calls", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a session and returns the user", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me", headers: authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ login: "admin", role: "admin" });
  });

  it("rejects non-GET without CSRF token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { ...authed(), "content-type": "application/json" },
      payload: { name: "app" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "CSRF" } });
  });

  it("rejects non-JSON bodies", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { ...write(), "content-type": "text/plain" },
      payload: "x=1",
    });
    expect(res.statusCode).toBe(415);
  });
});

describe("projects and keys", () => {
  it("creates a project with default envs (production protected)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: write(),
      payload: { name: "myapp" },
    });
    expect(res.statusCode).toBe(200);
    const envs = db
      .prepare("SELECT name, protected FROM environments WHERE project = ? ORDER BY name")
      .all("myapp") as { name: string; protected: number }[];
    expect(envs).toEqual([
      { name: "development", protected: 0 },
      { name: "production", protected: 1 },
      { name: "staging", protected: 0 },
    ]);
  });

  it("puts and reveals a key", async () => {
    ssmMock.on(GetParameterCommand).rejects(
      Object.assign(new Error("nf"), { name: "ParameterNotFound" }),
    );
    ssmMock.on(PutParameterCommand).resolves({ Version: 1 });
    const put = await app.inject({
      method: "PUT",
      url: "/api/projects/myapp/envs/development/keys/API_KEY",
      headers: write(),
      payload: { value: "secret-value" },
    });
    expect(put.statusCode).toBe(200);

    ssmMock.reset();
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: { Name: "/ferry/myapp/development/API_KEY", Value: "secret-value", Version: 1 },
    });
    const reveal = await app.inject({
      method: "GET",
      url: "/api/projects/myapp/envs/development/keys/API_KEY",
      headers: authed(),
    });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json()).toMatchObject({ value: "secret-value" });
    expect(reveal.headers["cache-control"]).toBe("no-store");
  });

  it("lists keys via DescribeParameters", async () => {
    ssmMock.on(DescribeParametersCommand).resolves({
      Parameters: [{ Name: "/ferry/myapp/development/API_KEY", Version: 1 }],
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/myapp/envs/development/keys",
      headers: authed(),
    });
    expect(res.json()).toMatchObject({ keys: [{ key: "API_KEY", version: 1 }] });
  });

  it("blocks protected-env writes without X-Confirm", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/myapp/envs/production/keys/K",
      headers: write(),
      payload: { value: "v" },
    });
    expect(res.statusCode).toBe(428);
    expect(res.json()).toMatchObject({ error: { code: "CONFIRM_REQUIRED" } });
  });

  it("allows protected-env writes with X-Confirm", async () => {
    ssmMock.on(GetParameterCommand).rejects(
      Object.assign(new Error("nf"), { name: "ParameterNotFound" }),
    );
    ssmMock.on(PutParameterCommand).resolves({ Version: 1 });
    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/myapp/envs/production/keys/K",
      headers: { ...write(), "x-confirm": "production" },
      payload: { value: "v" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("deletes a key and audits it", async () => {
    ssmMock.on(DeleteParameterCommand).resolves({});
    const res = await app.inject({
      method: "DELETE",
      url: "/api/projects/myapp/envs/development/keys/API_KEY",
      headers: { ...authed(), "x-csrf-token": CSRF },
    });
    expect(res.statusCode).toBe(200);
    const row = db
      .prepare("SELECT action, key_name FROM audit_log WHERE action = 'key.delete'")
      .get() as { action: string; key_name: string } | undefined;
    expect(row?.key_name).toBe("API_KEY");
  });

  it("rejects path traversal attempts", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/myapp/envs/development/keys/..%2Fsecret",
      headers: authed(),
    });
    expect([400, 404]).toContain(res.statusCode);
  });
});
