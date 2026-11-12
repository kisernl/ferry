import type { FastifyInstance } from "fastify";
import type { Ctx } from "../ctx.js";
import { projectRoleName, sharedRoleName } from "@ferry/shared";
import { envParams } from "./keys.js";

function workflowYaml(opts: {
  accountId: string;
  region: string;
  roleName: string;
  prefix: string;
  project: string;
  env: string;
}): string {
  const { accountId, region, roleName, prefix, project, env } = opts;
  return `jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${env}
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${accountId}:role/${roleName}
          aws-region: ${region}

      - name: Load env from Ferry
        run: |
          aws ssm get-parameters-by-path \\
            --path "/${prefix}/${project}/${env}/" \\
            --with-decryption --recursive \\
            --query "Parameters[].[Name,Value]" --output json |
          jq -c '.[]' |
          while IFS= read -r row; do
            name=$(jq -r '.[0] | split("/") | last' <<<"$row")
            value=$(jq -r '.[1]' <<<"$row")
            while IFS= read -r line; do
              echo "::add-mask::$line"
            done <<<"$value"
            delim="ferry_$(openssl rand -hex 8)"
            printf '%s<<%s\\n%s\\n%s\\n' "$name" "$delim" "$value" "$delim" >> "$GITHUB_ENV"
          done
`;
}

export function snippetsRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, guard, github, config } = ctx;

  app.get(
    "/api/projects/:project/envs/:env/snippets",
    { preHandler: [guard.requireRole("viewer")] },
    async (req) => {
      const { project, env } = envParams(req);
      const prefix = config.FERRY_PREFIX;
      const region = config.AWS_REGION;
      const { repo } = req.query as { repo?: string };
      const accountId = await github.getAccountId();

      // Which role applies to the requested repo?
      let roleName: string | null = null;
      let reason: string | null = null;
      if (repo) {
        const [ownerName, repoName] = repo.split("/") as [string, string];
        const owner = db
          .prepare("SELECT mode FROM github_owners WHERE owner = ?")
          .get(ownerName) as { mode: string } | undefined;
        if (!owner) {
          reason = `owner "${ownerName}" is not connected`;
        } else if (owner.mode === "all") {
          roleName = sharedRoleName(prefix, env);
        } else {
          const assigned = db
            .prepare(
              "SELECT 1 FROM github_repos WHERE owner = ? AND repo = ? AND project = ?",
            )
            .get(ownerName, repoName, project);
          roleName = assigned ? projectRoleName(prefix, project, env) : null;
          if (!assigned) reason = `${repo} is not assigned to project ${project}`;
        }
      }

      const iamStatement = {
        Sid: "ReadFerryEnv",
        Effect: "Allow",
        Action: [
          "ssm:GetParametersByPath",
          "ssm:GetParameters",
          "ssm:GetParameter",
        ],
        Resource: [
          `arn:aws:ssm:${region}:${accountId}:parameter/${prefix}/${project}/${env}`,
          `arn:aws:ssm:${region}:${accountId}:parameter/${prefix}/${project}/${env}/*`,
        ],
      };

      return {
        repo: repo ?? null,
        roleName,
        reason,
        githubActions:
          repo && roleName
            ? workflowYaml({ accountId, region, roleName, prefix, project, env })
            : null,
        awsCli: `aws ssm get-parameters-by-path --path /${prefix}/${project}/${env}/ --with-decryption`,
        node: `import { SSMClient, GetParametersByPathCommand } from "@aws-sdk/client-ssm";
const ssm = new SSMClient({ region: "${region}" });
const out = await ssm.send(new GetParametersByPathCommand({
  Path: "/${prefix}/${project}/${env}/",
  WithDecryption: true,
}));
for (const p of out.Parameters ?? []) {
  process.env[p.Name.split("/").pop()] = p.Value;
}`,
        python: `import boto3, os
ssm = boto3.client("ssm", region_name="${region}")
res = ssm.get_parameters_by_path(Path="/${prefix}/${project}/${env}/", WithDecryption=True)
for p in res["Parameters"]:
    os.environ[p["Name"].split("/")[-1]] = p["Value"]`,
        iamStatement,
      };
    },
  );
}
