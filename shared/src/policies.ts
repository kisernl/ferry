/** IAM trust/read policy and setup-script builders for GitHub Actions OIDC.
 *  Pure functions: everything is generated here so it can be unit-tested
 *  without touching AWS. */

export type OwnerMode = "all" | "selected";

export interface OwnerRecord {
  owner: string;
  mode: OwnerMode;
}

export interface RepoRecord {
  owner: string;
  repo: string; // bare repo name, not owner/repo
  projects: string[];
}

export interface RoleSpec {
  name: string;
  env: string;
  project: string | null; // null = shared (All repos) role
  trustPolicy: unknown;
  readPolicy: unknown;
}

const OIDC_PROVIDER = "token.actions.githubusercontent.com";
const TRUST_POLICY_MAX = 2048;
const ROLE_NAME_MAX = 64;

export class PolicyError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function sharedRoleName(prefix: string, env: string): string {
  return checkRoleName(`${prefix}-${env}`);
}

export function projectRoleName(
  prefix: string,
  project: string,
  env: string,
): string {
  return checkRoleName(`${prefix}-${project}-${env}`);
}

function checkRoleName(name: string): string {
  if (name.length > ROLE_NAME_MAX) {
    throw new PolicyError(
      "ROLE_NAME_TOO_LONG",
      `IAM role name "${name}" is ${name.length} characters (max ${ROLE_NAME_MAX}). Use a shorter project or environment name.`,
    );
  }
  return name;
}

export function trustPolicy(accountId: string, subs: string[]): unknown {
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          Federated: `arn:aws:iam::${accountId}:oidc-provider/${OIDC_PROVIDER}`,
        },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            [`${OIDC_PROVIDER}:aud`]: "sts.amazonaws.com",
          },
          StringLike: {
            [`${OIDC_PROVIDER}:sub`]: subs,
          },
        },
      },
    ],
  };
  checkTrustSize(JSON.stringify(policy).length, subs);
  return policy;
}

function checkTrustSize(bytes: number, subs: string[]): void {
  if (bytes > TRUST_POLICY_MAX) {
    throw new PolicyError(
      "TRUST_POLICY_TOO_LARGE",
      `Trust policy would be ${bytes} characters (IAM max ${TRUST_POLICY_MAX}) with ${subs.length} trusted repos. Assign fewer repos or use shorter names.`,
    );
  }
}

export function sharedReadPolicy(
  prefix: string,
  env: string,
  accountId: string,
  region: string,
): unknown {
  const base = `arn:aws:ssm:${region}:${accountId}:parameter/${prefix}/*/${env}`;
  return readPolicy([base, `${base}/*`]);
}

export function projectReadPolicy(
  prefix: string,
  project: string,
  env: string,
  accountId: string,
  region: string,
): unknown {
  const base = `arn:aws:ssm:${region}:${accountId}:parameter/${prefix}/${project}/${env}`;
  return readPolicy([base, `${base}/*`]);
}

function readPolicy(resources: string[]): unknown {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "ReadFerryEnv",
        Effect: "Allow",
        Action: [
          "ssm:GetParametersByPath",
          "ssm:GetParameters",
          "ssm:GetParameter",
        ],
        Resource: resources,
      },
    ],
  };
}

export interface BuildRolesInput {
  prefix: string;
  accountId: string;
  region: string;
  envs: string[]; // every environment name across projects
  owners: OwnerRecord[];
  repos: RepoRecord[];
  projects: string[]; // needed for selected-mode roles
}

/**
 * Compute the full desired set of IAM roles for the current owners/repos/envs.
 * All-repos owners share one `{prefix}-{env}` role per environment.
 * Selected repos produce one `{prefix}-{project}-{env}` role per project+env.
 */
export function buildRoles(input: BuildRolesInput): RoleSpec[] {
  const { prefix, accountId, region, envs, owners, repos, projects } = input;
  const roles = new Map<string, RoleSpec>();

  const allOwners = owners.filter((o) => o.mode === "all").map((o) => o.owner);
  const selectedRepos = repos.filter((r) =>
    owners.some((o) => o.owner === r.owner && o.mode === "selected"),
  );

  // Shared roles: one per env, if any All-repos owner exists.
  if (allOwners.length > 0) {
    for (const env of envs) {
      const subs = allOwners.map((o) => `repo:${o}/*:environment:${env}`);
      roles.set(`shared:${env}`, {
        name: sharedRoleName(prefix, env),
        env,
        project: null,
        trustPolicy: trustPolicy(accountId, subs),
        readPolicy: sharedReadPolicy(prefix, env, accountId, region),
      });
    }
  }

  // Project roles: only for projects that have selected-mode repos assigned.
  const byProject = new Map<string, Set<string>>();
  for (const r of selectedRepos) {
    for (const p of r.projects) {
      const subs = byProject.get(p) ?? new Set<string>();
      subs.add(`repo:${r.owner}/${r.repo}`);
      byProject.set(p, subs);
    }
  }
  for (const project of projects) {
    const subs = byProject.get(project);
    if (!subs) continue;
    for (const env of envs) {
      const envSubs = [...subs].map((s) => `${s}:environment:${env}`);
      roles.set(`project:${project}:${env}`, {
        name: projectRoleName(prefix, project, env),
        env,
        project,
        trustPolicy: trustPolicy(accountId, envSubs),
        readPolicy: projectReadPolicy(prefix, project, env, accountId, region),
      });
    }
  }

  return [...roles.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A single copy-paste bash script that creates the OIDC provider and every
 *  role with its inline read policy. */
export function buildSetupScript(roles: RoleSpec[]): string {
  const chunks: string[] = [
    `#!/usr/bin/env bash
set -euo pipefail

# Once per AWS account: trust GitHub's OIDC issuer
aws iam create-open-id-connect-provider \\
  --url https://${OIDC_PROVIDER} \\
  --client-id-list sts.amazonaws.com \\
  || echo "OIDC provider already exists, continuing"
`,
  ];

  for (const role of roles) {
    const trustFile = `/tmp/${role.name}-trust.json`;
    const readFile = `/tmp/${role.name}-read.json`;
    chunks.push(`
cat > ${trustFile} <<'JSON'
${JSON.stringify(role.trustPolicy, null, 2)}
JSON
cat > ${readFile} <<'JSON'
${JSON.stringify(role.readPolicy, null, 2)}
JSON
aws iam create-role --role-name ${role.name} \\
  --assume-role-policy-document file://${trustFile} \\
  --tags Key=managed-by,Value=ferry \\
  || aws iam update-assume-role-policy --role-name ${role.name} \\
       --policy-document file://${trustFile}
aws iam put-role-policy --role-name ${role.name} \\
  --policy-name read-env \\
  --policy-document file://${readFile}
`);
  }

  return chunks.join("\n");
}

/** Bash snippet to delete a role that is no longer needed. */
export function buildDeleteRoleScript(roleName: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
aws iam delete-role-policy --role-name ${roleName} --policy-name read-env || true
aws iam delete-role --role-name ${roleName}
`;
}
