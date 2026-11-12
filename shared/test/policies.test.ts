import { describe, expect, it } from "vitest";
import {
  buildRoles,
  buildSetupScript,
  PolicyError,
  projectRoleName,
  sharedRoleName,
} from "../src/policies.js";

const base = {
  prefix: "ferry",
  accountId: "123456789012",
  region: "us-east-1",
};

describe("role names", () => {
  it("builds shared and project role names", () => {
    expect(sharedRoleName("ferry", "production")).toBe("ferry-production");
    expect(projectRoleName("ferry", "myapp", "production")).toBe(
      "ferry-myapp-production",
    );
  });

  it("rejects names over 64 chars", () => {
    expect(() =>
      projectRoleName("ferry", "p".repeat(40), "e".repeat(30)),
    ).toThrow(PolicyError);
  });
});

describe("buildRoles", () => {
  it("all-repos mode: one shared role per env with wildcard sub", () => {
    const roles = buildRoles({
      ...base,
      envs: ["staging", "production"],
      owners: [{ owner: "noah-dev", mode: "all" }],
      repos: [],
      projects: ["myapp"],
    });
    expect(roles.map((r) => r.name)).toEqual([
      "ferry-production",
      "ferry-staging",
    ]);
    const trust = roles[0]!.trustPolicy as any;
    expect(trust.Statement[0].Condition.StringLike[
      "token.actions.githubusercontent.com:sub"
    ]).toEqual(["repo:noah-dev/*:environment:production"]);
  });

  it("all-repos with several owners unions the subs", () => {
    const roles = buildRoles({
      ...base,
      envs: ["production"],
      owners: [
        { owner: "o1", mode: "all" },
        { owner: "o2", mode: "all" },
      ],
      repos: [],
      projects: [],
    });
    const trust = roles[0]!.trustPolicy as any;
    expect(
      trust.Statement[0].Condition.StringLike[
        "token.actions.githubusercontent.com:sub"
      ],
    ).toEqual([
      "repo:o1/*:environment:production",
      "repo:o2/*:environment:production",
    ]);
  });

  it("selected mode: project roles list only assigned repos", () => {
    const roles = buildRoles({
      ...base,
      envs: ["production"],
      owners: [{ owner: "acme", mode: "selected" }],
      repos: [
        { owner: "acme", repo: "api", projects: ["myapp"] },
        { owner: "acme", repo: "worker", projects: ["myapp"] },
        { owner: "acme", repo: "other", projects: ["otherapp"] },
      ],
      projects: ["myapp", "otherapp", "emptyapp"],
    });
    expect(roles.map((r) => r.name).sort()).toEqual([
      "ferry-myapp-production",
      "ferry-otherapp-production",
    ]);
    const myapp = roles.find((r) => r.name === "ferry-myapp-production")!;
    const subs = (myapp.trustPolicy as any).Statement[0].Condition.StringLike[
      "token.actions.githubusercontent.com:sub"
    ];
    expect(subs.sort()).toEqual([
      "repo:acme/api:environment:production",
      "repo:acme/worker:environment:production",
    ]);
  });

  it("selected-mode repos under an all-mode owner are ignored", () => {
    const roles = buildRoles({
      ...base,
      envs: ["production"],
      owners: [{ owner: "acme", mode: "all" }],
      repos: [{ owner: "acme", repo: "api", projects: ["myapp"] }],
      projects: ["myapp"],
    });
    expect(roles).toHaveLength(1);
    expect(roles[0]!.project).toBeNull();
  });

  it("a repo assigned to several projects appears in each role", () => {
    const roles = buildRoles({
      ...base,
      envs: ["production"],
      owners: [{ owner: "acme", mode: "selected" }],
      repos: [{ owner: "acme", repo: "api", projects: ["p1", "p2"] }],
      projects: ["p1", "p2"],
    });
    expect(roles).toHaveLength(2);
    for (const r of roles) {
      const subs = (r.trustPolicy as any).Statement[0].Condition.StringLike[
        "token.actions.githubusercontent.com:sub"
      ];
      expect(subs).toEqual(["repo:acme/api:environment:production"]);
    }
  });

  it("never emits bare repo or ref subjects", () => {
    const roles = buildRoles({
      ...base,
      envs: ["prod"],
      owners: [{ owner: "o", mode: "all" }],
      repos: [],
      projects: [],
    });
    const json = JSON.stringify(roles[0]!.trustPolicy);
    expect(json).not.toContain(":ref:");
    expect(json).not.toContain('repo:o/*"');
  });

  it("fails when the trust policy would exceed 2048 chars", () => {
    const repos = Array.from({ length: 40 }, (_, i) => ({
      owner: "acme-corp",
      repo: `repo-number-${i}`,
      projects: ["myapp"],
    }));
    expect(() =>
      buildRoles({
        ...base,
        envs: ["production"],
        owners: [{ owner: "acme-corp", mode: "selected" }],
        repos,
        projects: ["myapp"],
      }),
    ).toThrow(/2048/);
  });
});

describe("buildSetupScript", () => {
  it("creates the OIDC provider and each role with its policies", () => {
    const roles = buildRoles({
      ...base,
      envs: ["production"],
      owners: [{ owner: "acme", mode: "all" }],
      repos: [],
      projects: [],
    });
    const script = buildSetupScript(roles);
    expect(script).toContain("create-open-id-connect-provider");
    expect(script).toContain("--role-name ferry-production");
    expect(script).toContain("put-role-policy");
    expect(script).toContain("--policy-name read-env");
    expect(script).toContain("managed-by,Value=ferry");
  });
});
