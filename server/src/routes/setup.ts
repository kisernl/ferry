import type { FastifyInstance } from "fastify";
import type { Ctx } from "../ctx.js";
import { audit } from "../lib/audit.js";
import { user } from "../guard.js";

function serverIamPolicy(region: string, accountId: string, prefix: string) {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "ManageFerryParameters",
        Effect: "Allow",
        Action: [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
          "ssm:GetParameterHistory",
          "ssm:PutParameter",
          "ssm:DeleteParameter",
          "ssm:DeleteParameters",
          "ssm:AddTagsToResource",
          "ssm:ListTagsForResource",
        ],
        Resource: `arn:aws:ssm:${region}:${accountId}:parameter/${prefix}/*`,
      },
      {
        Sid: "DescribeNeedsWildcard",
        Effect: "Allow",
        Action: "ssm:DescribeParameters",
        Resource: "*",
      },
    ],
  };
}

function optionalIamPolicy(accountId: string, prefix: string) {
  return {
    Sid: "CheckGithubSetup",
    Effect: "Allow",
    Action: ["iam:GetRole", "iam:GetOpenIDConnectProvider"],
    Resource: [
      `arn:aws:iam::${accountId}:role/${prefix}-*`,
      `arn:aws:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com`,
    ],
  };
}

/** Identity resolution must not be fatal: when the server has no working AWS
 *  credentials this page is exactly where the admin goes to fix that, so we
 *  still return the config and IAM policies (with an {ACCOUNT_ID} placeholder). */
async function resolveIdentity(ctx: Ctx) {
  try {
    const { account, arn } = await ctx.github.callerIdentity();
    return { account, arn, error: null as string | null };
  } catch (e) {
    return {
      account: null,
      arn: null,
      error: (e as { name?: string })?.name ?? String(e),
    };
  }
}

function setupPayload(ctx: Ctx, id: Awaited<ReturnType<typeof resolveIdentity>>) {
  const account = id.account ?? "{ACCOUNT_ID}";
  return {
    identity: {
      account: id.account,
      arn: id.arn,
      error: id.error,
      region: ctx.config.AWS_REGION,
      prefix: ctx.config.FERRY_PREFIX,
      kmsKeyId: ctx.config.KMS_KEY_ID ?? null,
    },
    iamPolicy: serverIamPolicy(ctx.config.AWS_REGION, account, ctx.config.FERRY_PREFIX),
    optionalIamPolicy: optionalIamPolicy(account, ctx.config.FERRY_PREFIX),
  };
}

export function setupRoutes(app: FastifyInstance, ctx: Ctx) {
  /** Identity + policies without running probes — powers the always-visible
   *  prerequisites on the setup page. */
  app.get(
    "/api/setup/info",
    { preHandler: [ctx.guard.requireRole("admin")] },
    async () => setupPayload(ctx, await resolveIdentity(ctx)),
  );

  app.post(
    "/api/setup/check",
    { preHandler: [ctx.guard.requireRole("admin")] },
    async (req) => {
      const id = await resolveIdentity(ctx);
      const checks = await ctx.params.probe();
      audit(ctx.db, {
        action: "setup.check",
        userLogin: user(req).login,
        ip: req.ip,
        detail: checks.every((c) => c.ok) ? "all passed" : "failures",
      });
      return { checks, ...setupPayload(ctx, id) };
    },
  );
}
