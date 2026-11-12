import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, type Me } from "@/lib/api";
import { relativeTime, useProjects } from "@/lib/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProjectsPage({ me }: { me: Me }) {
  const { data, isLoading, refetch } = useProjects();
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const isAdmin = me.role === "admin";

  const rescan = useMutation({
    mutationFn: () => api.post<{ added: { project: string; env: string }[] }>("/api/rescan"),
    onSuccess: (r) => {
      toast.success(`Rescan complete: ${r.added.length} new environments found`);
      void refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Each project maps to a path in AWS SSM Parameter Store —{" "}
            <code className="font-mono text-xs">/ferry/&lt;project&gt;/&lt;env&gt;/&lt;KEY&gt;</code>.
            Parameters created outside this app appear after a rescan.
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => rescan.mutate()} disabled={rescan.isPending}>
              <RefreshCw className={rescan.isPending ? "animate-spin" : ""} /> Rescan AWS
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus /> New project
            </Button>
          </div>
        )}
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {data?.projects.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No projects yet</p>
          <p className="mt-1">
            {isAdmin
              ? "Create a project above, or press Rescan AWS to import parameters that already exist under the /ferry/ prefix."
              : "Ask an admin to create a project or rescan AWS."}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {data?.projects.map((p) => (
          <Card key={p.name}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="font-mono text-base">{p.name}</CardTitle>
              {isAdmin && <DeleteProjectButton name={p.name} envs={p.environments} />}
            </CardHeader>
            <CardContent className="space-y-1">
              {p.environments.map((e) => (
                <Link
                  key={e.name}
                  to={`/p/${p.name}/${e.name}`}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    {e.name}
                    {e.protected && <Badge variant="warning">protected</Badge>}
                  </span>
                  <span className="text-muted-foreground">
                    {e.keyCount} keys · {relativeTime(e.lastModified)}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} onCreated={() => qc.invalidateQueries({ queryKey: ["projects"] })} />
    </div>
  );
}

function NewProjectDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [envs, setEnvs] = useState("development, staging, production");
  const create = useMutation({
    mutationFn: () =>
      api.post("/api/projects", {
        name,
        environments: envs.split(",").map((s) => s.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      toast.success(`Project ${name} created`);
      onOpenChange(false);
      setName("");
      onCreated();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pname">Name</Label>
            <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="myapp" className="font-mono" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="envs">Environments (comma-separated)</Label>
            <Input id="envs" value={envs} onChange={(e) => setEnvs(e.target.value)} className="font-mono" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!name || create.isPending}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProjectButton({ name, envs }: { name: string; envs: { keyCount: number }[] }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState("");
  const [open, setOpen] = useState(false);
  const keyCount = envs.reduce((n, e) => n + e.keyCount, 0);
  const del = useMutation({
    mutationFn: () => api.del(`/api/projects/${name}${keyCount > 0 ? "?force=true" : ""}`),
    onSuccess: () => {
      toast.success(`Project ${name} deleted`);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {keyCount > 0
              ? `This deletes the project and all ${keyCount} Parameter Store keys under it. This cannot be undone.`
              : "This deletes the project. It has no keys."}
          </p>
          {keyCount > 0 && (
            <div className="space-y-1">
              <Label>Type the project name to confirm</Label>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="font-mono" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={(keyCount > 0 && confirm !== name) || del.isPending}
              onClick={() => del.mutate()}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
