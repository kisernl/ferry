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

export function setupRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post(
    "/api/setup/check",
    { preHandler: [ctx.guard.requireRole("admin")] },
    async (req) => {
      const identity = await ctx.github.callerIdentity();
      const checks = await ctx.params.probe();
      audit(ctx.db, {
        action: "setup.check",
        userLogin: user(req).login,
        ip: req.ip,
        detail: checks.every((c) => c.ok) ? "all passed" : "failures",
      });
      const account = identity.account ?? "{ACCOUNT_ID}";
      return {
        identity: {
          account: identity.account,
          arn: identity.arn,
          region: ctx.config.AWS_REGION,
          prefix: ctx.config.FERRY_PREFIX,
          kmsKeyId: ctx.config.KMS_KEY_ID ?? null,
        },
        checks,
        iamPolicy: serverIamPolicy(ctx.config.AWS_REGION, account, ctx.config.FERRY_PREFIX),
        optionalIamPolicy: optionalIamPolicy(account, ctx.config.FERRY_PREFIX),
      };
    },
  );
}
