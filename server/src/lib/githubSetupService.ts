import {
  GetOpenIDConnectProviderCommand,
  GetRoleCommand,
  IAMClient,
  NoSuchEntityException,
} from "@aws-sdk/client-iam";
import {
  STSClient,
  GetCallerIdentityCommand,
} from "@aws-sdk/client-sts";
import {
  buildDeleteRoleScript,
  buildRoles,
  buildSetupScript,
  type OwnerRecord,
  type RepoRecord,
  type RoleSpec,
} from "@ferry/shared";
import type Database from "better-sqlite3";

/** Generates policies and scripts, and checks that roles exist.
 *  Never writes to IAM — the admin runs the generated script. */
export class GithubSetupService {
  constructor(
    private db: Database.Database,
    private iam: IAMClient,
    private sts: STSClient,
    private prefix: string,
    private region: string,
  ) {}

  private accountId: string | null = null;

  async getAccountId(): Promise<string> {
    if (!this.accountId) {
      const res = await this.sts.send(new GetCallerIdentityCommand({}));
      if (!res.Account) throw new Error("sts:GetCallerIdentity returned no account");
      this.accountId = res.Account;
    }
    return this.accountId;
  }

  async callerIdentity() {
    const res = await this.sts.send(new GetCallerIdentityCommand({}));
    return { account: res.Account ?? null, arn: res.Arn ?? null };
  }

  owners(): OwnerRecord[] {
    return this.db
      .prepare("SELECT owner, mode FROM github_owners ORDER BY owner")
      .all() as OwnerRecord[];
  }

  repos(): RepoRecord[] {
    return this.db
      .prepare(
        "SELECT owner, repo, project FROM github_repos ORDER BY owner, repo, project",
      )
      .all() as RepoRecord[];
  }

  envs(): string[] {
    return (
      this.db
        .prepare("SELECT name FROM environments ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);
  }

  projects(): string[] {
    return (
      this.db.prepare("SELECT name FROM projects ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
  }

  /** The desired set of IAM roles for current owners/repos/envs. */
  async roles(): Promise<RoleSpec[]> {
    const accountId = await this.getAccountId();
    return buildRoles({
      prefix: this.prefix,
      accountId,
      region: this.region,
      envs: this.envs(),
      owners: this.owners(),
      repos: this.repos(),
      projects: this.projects(),
    });
  }

  async setupScript(): Promise<string> {
    return buildSetupScript(await this.roles());
  }

  deleteRoleScript(roleName: string): string {
    return buildDeleteRoleScript(roleName);
  }

  /** Verify provider + each role exists. Requires the optional read-only IAM
   *  policy; reports "not_verified" when the server lacks it. */
  async check(): Promise<
    | { available: false }
    | { available: true; provider: boolean; roles: { name: string; ok: boolean }[] }
  > {
    let provider = false;
    try {
      await this.iam.send(
        new GetOpenIDConnectProviderCommand({
          OpenIDConnectProviderArn: `arn:aws:iam::${await this.getAccountId()}:oidc-provider/token.actions.githubusercontent.com`,
        }),
      );
      provider = true;
    } catch (e) {
      if (this.isDenied(e)) return { available: false };
      provider = false; // exists check failed = missing
    }

    const roleChecks: { name: string; ok: boolean }[] = [];
    for (const role of await this.roles()) {
      try {
        await this.iam.send(new GetRoleCommand({ RoleName: role.name }));
        roleChecks.push({ name: role.name, ok: true });
      } catch (e) {
        if (this.isDenied(e)) return { available: false };
        if (e instanceof NoSuchEntityException) {
          roleChecks.push({ name: role.name, ok: false });
        } else {
          roleChecks.push({ name: role.name, ok: false });
        }
      }
    }
    return { available: true, provider, roles: roleChecks };
  }

  private isDenied(e: unknown): boolean {
    const name = (e as { name?: string })?.name ?? "";
    return /AccessDenied|NotAuthorized|UnauthorizedOperation/.test(name);
  }
}
