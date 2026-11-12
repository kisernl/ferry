import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, XCircle } from "lucide-react";
import { api, type Me } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SetupResult {
  identity: { account: string | null; arn: string | null; region: string; prefix: string; kmsKeyId: string | null };
  checks: { action: string; ok: boolean; detail: string }[];
  iamPolicy: unknown;
  optionalIamPolicy: unknown;
}

export function SetupPage({ me }: { me: Me }) {
  const [result, setResult] = useState<SetupResult | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Setup check</h1>
          <p className="text-sm text-muted-foreground">
            Verifies that this server's AWS credentials can use Parameter Store under your prefix —
            including a real write/delete probe. Run this after changing IAM policies.
          </p>
        </div>
        <Button onClick={run} disabled={busy}>{busy ? "Running…" : "Run checks"}</Button>
      </div>

      {result && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">AWS identity</CardTitle></CardHeader>
            <CardContent className="space-y-1 font-mono text-sm">
              <p>Account: {result.identity.account}</p>
              <p>Region: {result.identity.region}</p>
              <p>ARN: {result.identity.arn}</p>
              <p>Prefix: /{result.identity.prefix}</p>
              <p>KMS key: {result.identity.kmsKeyId ?? "alias/aws/ssm (default)"}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Permission probes</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {result.checks.map((c) => (
                <div key={c.action} className="flex items-center gap-2 text-sm">
                  {c.ok
                    ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                    : <XCircle className="h-4 w-4 text-destructive" />}
                  <span className="font-mono">{c.action}</span>
                  {!c.ok && <Badge variant="destructive">{c.detail}</Badge>}
                </div>
              ))}
            </CardContent>
          </Card>

          <PolicyCard title="Required IAM policy" policy={result.iamPolicy} />
          <PolicyCard title="Optional: read-only IAM check policy" policy={result.optionalIamPolicy} />
        </>
      )}
    </div>
  );
}

function PolicyCard({ title, policy }: { title: string; policy: unknown }) {
  const json = JSON.stringify(policy, null, 2);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(json); toast.success("Copied"); }}>
          <Copy /> Copy
        </Button>
      </CardHeader>
      <CardContent>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{json}</pre>
      </CardContent>
    </Card>
  );
}
