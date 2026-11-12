import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetOpenIDConnectProviderCommand,
  GetRoleCommand,
  IAMClient,
} from "@aws-sdk/client-iam";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { openDb } from "../src/db.js";
import { GithubSetupService } from "../src/lib/githubSetupService.js";

const iam = new IAMClient({ region: "us-east-1" });
const sts = new STSClient({ region: "us-east-1" });
const iamMock = mockClient(iam);
const stsMock = mockClient(sts);

function svc() {
  const db = openDb(mkdtempSync(join(tmpdir(), "ferry-gh-")));
  db.prepare("INSERT INTO projects (name) VALUES ('myapp')").run();
  db.prepare(
    "INSERT INTO environments (project, name) VALUES ('myapp', 'production')",
  ).run();
  return { db, svc: new GithubSetupService(db, iam, sts, "ferry", "us-east-1") };
}

beforeEach(() => {
  iamMock.reset();
  stsMock.reset();
  stsMock.on(GetCallerIdentityCommand).resolves({ Account: "123456789012" });
});

describe("check", () => {
  it("returns not available without IAM read access", async () => {
    iamMock.rejects(Object.assign(new Error("denied"), { name: "AccessDenied" }));
    const { svc: s } = svc();
    expect(await s.check()).toEqual({ available: false });
  });

  it("reports provider + role status with read access", async () => {
    const { db, svc: s } = svc();
    db.prepare("INSERT INTO github_owners (owner, mode) VALUES ('acme', 'all')").run();
    iamMock.on(GetOpenIDConnectProviderCommand).resolves({});
    iamMock.on(GetRoleCommand).resolves({ Role: { RoleName: "ferry-production" } as never });
    const res = await s.check();
    expect(res).toMatchObject({
      available: true,
      provider: true,
      roles: [{ name: "ferry-production", ok: true }],
    });
  });

  it("marks missing roles", async () => {
    const { db, svc: s } = svc();
    db.prepare("INSERT INTO github_owners (owner, mode) VALUES ('acme', 'all')").run();
    iamMock.on(GetOpenIDConnectProviderCommand).resolves({});
    iamMock.on(GetRoleCommand).rejects(
      Object.assign(new Error("no"), { name: "NoSuchEntityException" }),
    );
    const res = await s.check();
    expect(res).toMatchObject({ available: true, roles: [{ ok: false }] });
  });
});
