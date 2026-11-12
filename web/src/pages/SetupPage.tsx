import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Copy, XCircle } from "lucide-react";
import { api, type Me } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Identity {
  account: string | null;
  arn: string | null;
  error: string | null;
  region: string;
  prefix: string;
  kmsKeyId: string | null;
}
interface Check {
  action: string;
  ok: boolean;
  detail: string;
  message?: string;
}
interface SetupInfo {
  identity: Identity;
  iamPolicy: unknown;
  optionalIamPolicy: unknown;
}
interface SetupResult extends SetupInfo {
  checks: Check[];
}

/** What each probe exercises — keyed by the action name the server reports. */
function probePurpose(action: string, prefix: string): string {
  switch (action) {
    case "ssm:DescribeParameters":
      return 'list parameter metadata — needs Resource "*" (cannot be path-scoped)';
    case "ssm:GetParametersByPath":
      return `list keys under /${prefix}/`;
    case "ssm:PutParameter":
      return "write the probe secret (SecureString)";
    case "ssm:GetParameter":
      return "read and decrypt the probe";
    case "ssm:DeleteParameter":
      return "delete the probe";
    case "ssm:GetParameterHistory":
      return "read version history (key history/restore)";
    default:
      return "";
  }
}

/** Plain-language next step when a probe fails, based on the AWS error name. */
function failureHint(c: Check, identity: Identity): string {
  if (/credentials|token|signature/i.test(c.detail + (c.message ?? ""))) {
    return "The server has no usable AWS credentials. Provide them through environment variables (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) or attach an IAM role to the instance, task, or pod running Ferry, then restart.";
  }
  if (/accessdenied|unauthorized|forbidden|not authorized/i.test(c.detail + (c.message ?? ""))) {
    let hint = "The server's IAM identity isn't allowed this action. Attach the required policy below to the role or user this server runs as, and check the resource ARN matches your prefix.";
    if (identity.kmsKeyId && (c.action === "ssm:PutParameter" || c.action === "ssm:GetParameter")) {
      hint += " KMS_KEY_ID is a customer-managed key — the identity also needs kms:GenerateDataKey and kms:Decrypt on that key.";
    }
    return hint;
  }
  return "See the AWS error below — usually a missing permission, a resource ARN that doesn't match the policy, or no credentials at all.";
}

export function SetupPage({ me }: { me: Me }) {
  const [result, setResult] = useState<SetupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: info, error: infoError } = useQuery({
    queryKey: ["setup-info"],
    queryFn: () => api.get<SetupInfo>("/api/setup/info"),
    enabled: me.role === "admin",
  });

  async function run() {
    setBusy(true);
    try {
      setResult(await api.post<SetupResult>("/api/setup/check", {}));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (me.role !== "admin") return <p>Admins only.</p>;

  const identity = result?.identity ?? info?.identity;
  const iamPolicy = result?.iamPolicy ?? info?.iamPolicy;
  const optionalIamPolicy = result?.optionalIamPolicy ?? info?.optionalIamPolicy;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Setup check</h1>
          <p className="text-sm text-muted-foreground">
            Verifies that this server's AWS credentials can manage secrets in Parameter Store —
            including a real write/delete probe. The sections below list everything that must be
            true for the checks to pass.
          </p>
        </div>
        <Button onClick={run} disabled={busy}>{busy ? "Running…" : "Run checks"}</Button>
      </div>

      {infoError && (
        <p className="text-sm text-destructive">
          Could not load server setup info: {infoError.message}
        </p>
      )}

      {identity && (
        <Card>
          <CardHeader><CardTitle className="text-base">What the server needs</CardTitle></CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">AWS credentials on this server.</strong> Ferry
                uses the standard AWS SDK credential chain — environment variables
                (<code className="font-mono">AWS_ACCESS_KEY_ID</code> /{" "}
                <code className="font-mono">AWS_SECRET_ACCESS_KEY</code>) or the IAM role attached
                to the instance, task, or pod. There is no AWS configuration inside Ferry itself.
              </li>
              <li>
                <strong className="text-foreground">The required IAM policy below,</strong> attached
                to that role or user. All secrets live under{" "}
                <code className="font-mono">/{identity.prefix}/</code> and the policy is scoped
                to <code className="font-mono">parameter/{identity.prefix}/*</code>, plus
                account-wide <code className="font-mono">ssm:DescribeParameters</code> (AWS does
                not allow that action to be path-scoped).
              </li>
              <li>
                {identity.kmsKeyId ? (
                  <>
                    <strong className="text-foreground">KMS permissions.</strong>{" "}
                    <code className="font-mono">KMS_KEY_ID</code> is set to a customer-managed key,
                    so the identity also needs <code className="font-mono">kms:GenerateDataKey</code>{" "}
                    and <code className="font-mono">kms:Decrypt</code> on that key — grant them on
                    the key policy or in IAM.
                  </>
                ) : (
                  <>
                    <strong className="text-foreground">No KMS setup needed.</strong> Secrets use the
                    AWS-managed <code className="font-mono">alias/aws/ssm</code> key, which works
                    without extra permissions. Set <code className="font-mono">KMS_KEY_ID</code> only
                    if you want your own key.
                  </>
                )}
              </li>
              <li>
                <strong className="text-foreground">Then run the checks.</strong> The probe writes,
                reads, and deletes a throwaway parameter at{" "}
                <code className="font-mono">/{identity.prefix}/__probe__/TEST</code> — it does not
                touch your real secrets.
              </li>
            </ol>
          </CardContent>
        </Card>
      )}

      {identity && (
        <Card>
          <CardHeader><CardTitle className="text-base">AWS identity</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {identity.account ? (
              <div className="space-y-1 font-mono">
                <p>Account: {identity.account}</p>
                <p>ARN: {identity.arn}</p>
              </div>
            ) : (
              <p className="text-destructive">
                Could not resolve the server's AWS identity
                {identity.error ? ` (${identity.error})` : ""} — the server most likely has no
                credentials yet.
              </p>
            )}
            <div className="font-mono">
              <p>Region: {identity.region}</p>
              <p>Prefix: /{identity.prefix}</p>
              <p>KMS key: {identity.kmsKeyId ?? "alias/aws/ssm (default)"}</p>
            </div>
            {!identity.account && (
              <p className="text-xs text-muted-foreground">
                The policies below use <code className="font-mono">{"{ACCOUNT_ID}"}</code> — replace
                it with your 12-digit AWS account ID before attaching.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Permission probes</CardTitle>
            {result.checks.every((c) => c.ok) && (
              <Badge variant="success">all checks passed</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {result.checks.map((c) => (
              <div key={c.action} className="text-sm">
                <div className="flex items-center gap-2">
                  {c.ok
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                    : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                  <span className="font-mono">{c.action}</span>
                  <span className="text-muted-foreground">
                    — {probePurpose(c.action, result.identity.prefix)}
                  </span>
                  {!c.ok && <Badge variant="destructive">{c.detail}</Badge>}
                </div>
                {!c.ok && (
                  <div className="space-y-1 pl-6 pt-1">
                    <p className="text-muted-foreground">{failureHint(c, result.identity)}</p>
                    {c.message && (
                      <p className="font-mono text-xs text-muted-foreground">{c.message}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {iamPolicy !== undefined && (
        <PolicyCard
          title="Required IAM policy"
          description="Attach this to the IAM role or user the server runs as. Without it, every probe above will fail with AccessDenied."
          policy={iamPolicy}
        />
      )}
      {optionalIamPolicy !== undefined && (
        <PolicyCard
          title="Optional: read-only IAM check policy"
          description="Only needed if you use the GitHub page — lets the server verify the OIDC provider and generated roles exist. Add it as a second statement alongside the required policy."
          policy={optionalIamPolicy}
        />
      )}
    </div>
  );
}

function PolicyCard({
  title,
  description,
  policy,
}: {
  title: string;
  description: string;
  policy: unknown;
}) {
  const json = JSON.stringify(policy, null, 2);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(json); toast.success("Copied"); }}>
          <Copy /> Copy
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">{description}</p>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{json}</pre>
      </CardContent>
    </Card>
  );
}
