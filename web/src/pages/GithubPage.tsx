import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Me } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface GhState {
  owners: { owner: string; mode: "all" | "selected" }[];
  repos: { owner: string; repo: string; project: string }[];
  roles: { name: string; env: string; project: string | null }[];
  script: string;
}

export function GithubPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["gh"],
    queryFn: () => api.get<GhState>("/api/github/owners"),
    enabled: me.role === "admin",
  });
  const [owner, setOwner] = useState("");
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [repoForm, setRepoForm] = useState({ repo: "", projects: "" });
  const [script, setScript] = useState<string | null>(null);
  const [check, setCheck] = useState<{ available: boolean; provider?: boolean; roles?: { name: string; ok: boolean }[] } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["gh"] });

  const mut = (fn: () => Promise<unknown>, ok: string) =>
    useMutation({
      mutationFn: fn,
      onSuccess: () => { toast.success(ok); void refresh(); },
      onError: (e) => toast.error(e.message),
    });

  const addOwner = mut(() => api.post("/api/github/owners", { owner, mode }), `Connected ${owner}`);
  const addRepo = mut(
    () => api.post("/api/github/repos", { repo: repoForm.repo, projects: repoForm.projects.split(",").map((s) => s.trim()).filter(Boolean) }),
    "Repo assigned",
  );

  if (me.role !== "admin") return <p>Admins only.</p>;

  const selectedOwners = new Set(data?.owners.filter((o) => o.mode === "selected").map((o) => o.owner));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">GitHub Actions access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect a GitHub owner so CI can read secrets through OIDC — nothing secret is stored in GitHub,
          and CI keeps working if this app is down. Run the generated script once with your own AWS credentials.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Connect an owner</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Owner (user or org)</Label>
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="acme" className="font-mono" />
          </div>
          <div className="space-y-1">
            <Label>Access mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "all" | "selected")}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All repos</SelectItem>
                <SelectItem value="selected">Selected repos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => addOwner.mutate()} disabled={!owner}>Connect</Button>
          <p className="w-full text-xs text-muted-foreground">
            {mode === "all"
              ? "All repos: any repo under the owner whose job uses a matching GitHub Environment can read every project's values for that env. Best for solo devs and trusted teams."
              : "Selected repos: each repo is assigned to a project and reads only that project's values. Best for orgs and stricter isolation."}
          </p>
        </CardContent>
      </Card>

      {data && data.owners.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Owners</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Owner</TableHead><TableHead>Mode</TableHead><TableHead>Repos</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {data.owners.map((o) => (
                  <TableRow key={o.owner}>
                    <TableCell className="font-mono">{o.owner}</TableCell>
                    <TableCell>
                      <Select
                        value={o.mode}
                        onValueChange={async (v) => {
                          try {
                            await api.patch(`/api/github/owners/${o.owner}`, { mode: v });
                            toast.success(`${o.owner} → ${v} mode`);
                            void refresh();
                          } catch (e) { toast.error((e as Error).message); }
                        }}
                      >
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All repos</SelectItem>
                          <SelectItem value="selected">Selected repos</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-sm">
                      {data.repos.filter((r) => r.owner === o.owner).map((r) => `${r.repo}→${r.project}`).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost" size="sm"
                        onClick={async () => {
                          try {
                            const res = await api.del<{ cleanupScript?: string }>(`/api/github/owners/${o.owner}`);
                            if (res.cleanupScript) setScript(res.cleanupScript);
                            toast.success(`${o.owner} removed`);
                            void refresh();
                          } catch (e) { toast.error((e as Error).message); }
                        }}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data && selectedOwners.size > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Assign a repo (Selected repos mode)</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Repo (owner/name)</Label>
              <Input value={repoForm.repo} onChange={(e) => setRepoForm({ ...repoForm, repo: e.target.value })} placeholder="acme/api" className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label>Projects (comma-separated)</Label>
              <Input value={repoForm.projects} onChange={(e) => setRepoForm({ ...repoForm, projects: e.target.value })} placeholder="myapp" className="font-mono" />
            </div>
            <Button onClick={() => addRepo.mutate()} disabled={!repoForm.repo || !repoForm.projects}>Assign</Button>
          </CardContent>
        </Card>
      )}

      {data && data.roles.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Setup</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setScript(data.script)}>View setup script</Button>
              <Button
                variant="outline" size="sm"
                onClick={async () => {
                  try {
                    setCheck(await api.post<typeof check>("/api/github/check", {}) as never);
                  } catch (e) { toast.error((e as Error).message); }
                }}
              >
                Check setup
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {check && !check.available && (
              <p className="text-sm text-muted-foreground">
                Not verified — the server lacks the optional read-only IAM policy (see Setup page).
              </p>
            )}
            {check?.available && (
              <p className="text-sm">
                OIDC provider:{" "}
                {check.provider ? <Badge variant="success">present</Badge> : <Badge variant="destructive">missing</Badge>}
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow><TableHead>Role</TableHead><TableHead>Env</TableHead><TableHead>Scope</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data.roles.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-mono text-xs">{r.name}</TableCell>
                    <TableCell>{r.env}</TableCell>
                    <TableCell className="text-sm">{r.project ?? "all projects"}</TableCell>
                    <TableCell>
                      {check?.available
                        ? (check.roles?.find((c) => c.name === r.name)?.ok
                          ? <Badge variant="success">exists</Badge>
                          : <Badge variant="destructive">missing</Badge>)
                        : <Badge variant="secondary">not verified</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!script} onOpenChange={(o) => !o && setScript(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Run this script once</DialogTitle></DialogHeader>
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{script}</pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScript(null)}>Close</Button>
            <Button onClick={() => { void navigator.clipboard.writeText(script ?? ""); toast.success("Copied"); }}>Copy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
