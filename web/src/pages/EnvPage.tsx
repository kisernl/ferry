import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Copy, Download, Eye, GitCompareArrows, History, Pencil,
  Plus, Search, Trash2, Wand2,
} from "lucide-react";
import { api, ApiError, type KeyMeta, type Me } from "@/lib/api";
import { relativeTime, useProject } from "@/lib/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirmEnv } from "@/components/env/confirmEnv";
import { ImportDialog } from "@/components/env/ImportDialog";
import { HistorySheet } from "@/components/env/HistorySheet";
import { DiffDialog } from "@/components/env/DiffDialog";
import { CopyDialog } from "@/components/env/CopyDialog";
import { SnippetsDialog } from "@/components/env/SnippetsDialog";

export function EnvPage({ me }: { me: Me }) {
  const { project: projectName = "", env = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { project } = useProject(projectName);
  const envInfo = project?.environments.find((e) => e.name === env);
  const isProtected = envInfo?.protected ?? false;
  const canWrite = me.role !== "viewer" && !(me.restricted && isProtected);
  const { confirm, dialog: confirmDialog } = useConfirmEnv(env, isProtected);

  const base = `/api/projects/${projectName}/envs/${env}`;
  const keysQ = useQuery({
    queryKey: ["keys", projectName, env],
    queryFn: () => api.get<{ keys: KeyMeta[] }>(`${base}/keys`),
    enabled: !!project,
  });

  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);

  const keys = keysQ.data?.keys ?? [];
  const filtered = keys.filter((k) =>
    k.key.toLowerCase().includes(search.toLowerCase()),
  );

  // Missing-keys banner: keys in siblings that are absent here.
  const siblings = project?.environments.filter((e) => e.name !== env) ?? [];
  const missing = useMissingKeys(projectName, env, siblings.map((s) => s.name), keys);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["keys", projectName, env] });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-muted-foreground hover:text-foreground">←</Link>
        <h1 className="font-mono text-xl font-semibold">{projectName}</h1>
        {isProtected && <Badge variant="warning">protected</Badge>}
        <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
          {me.role === "viewer"
            ? "Read-only — ask an editor to reveal or change keys"
            : "Reveals decrypt on demand and auto-hide · see the Docs page for import/diff/history"}
        </span>
      </div>

      {project && (
        <Tabs value={env} onValueChange={(e) => navigate(`/p/${projectName}/${e}`)}>
          <TabsList>
            {project.environments.map((e) => (
              <TabsTrigger key={e.name} value={e.name}>
                {e.name}{e.protected ? " 🔒" : ""}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {missing.length > 0 && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
          {missing.map((m) => (
            <p key={m.env}>
              <span className="font-mono">{env}</span> is missing{" "}
              {m.keys.map((k) => <code key={k} className="mx-0.5">{k}</code>)}{" "}
              from <span className="font-mono">{m.env}</span>
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter keys…"
            className="w-56 pl-8"
          />
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {canWrite && (
            <>
              <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add</Button>
              <Button size="sm" variant="outline" onClick={() => { setImportText(""); setImportOpen(true); }}>Import .env</Button>
            </>
          )}
          {me.role !== "viewer" && (
            <Button size="sm" variant="outline" onClick={async () => {
              const res = await api.download(`${base}/export`);
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${projectName}.${env}.env`;
              a.click();
              URL.revokeObjectURL(url);
            }}><Download /> Download</Button>
          )}
          {canWrite && siblings.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setCopyOpen(true)}>
              <Copy /> Copy env
            </Button>
          )}
          {siblings.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setDiffOpen(true)}>
              <GitCompareArrows /> Diff
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setSnippetsOpen(true)}>
            <Wand2 /> Use these values
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/4">Key</TableHead>
              <TableHead className="w-2/5">Value</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-16">Ver</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((k) => (
              <KeyRow
                key={k.key}
                meta={k}
                base={base}
                env={env}
                canWrite={canWrite}
                canReveal={me.role !== "viewer"}
                confirm={confirm}
                onChanged={invalidate}
                onHistory={() => setHistoryKey(k.key)}
              />
            ))}
            {adding && (
              <AddRow
                base={base}
                env={env}
                confirm={confirm}
                onDone={() => { setAdding(false); void invalidate(); }}
                onCancel={() => setAdding(false)}
              />
            )}
            {filtered.length === 0 && !adding && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {keys.length === 0
                    ? canWrite
                      ? "No keys yet — Add one above or Import .env to paste a whole file."
                      : "No keys in this environment yet."
                    : "No keys match the filter"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {confirmDialog}
      <ImportDialog
        project={projectName} env={env} isProtected={isProtected}
        open={importOpen} onOpenChange={setImportOpen} initialText={importText}
      />
      {historyKey && (
        <HistorySheet
          project={projectName} env={env} keyName={historyKey}
          canEdit={me.role !== "viewer"} open onOpenChange={(o) => !o && setHistoryKey(null)}
        />
      )}
      <DiffDialog
        project={projectName} envs={siblings.concat(envInfo ?? []).map((e) => e.name)}
        currentEnv={env} open={diffOpen} onOpenChange={setDiffOpen}
      />
      <CopyDialog
        project={projectName} env={env} envs={project?.environments.map((e) => e.name) ?? []}
        isProtected={isProtected} open={copyOpen} onOpenChange={setCopyOpen}
        onKeysOnly={(target, keyNames) => {
          setImportText(keyNames.map((k) => `${k}=`).join("\n"));
          setImportOpen(true);
          toast.info(`Draft import prepared for ${target} — fill in values and apply`);
        }}
      />
      <SnippetsDialog project={projectName} env={env} open={snippetsOpen} onOpenChange={setSnippetsOpen} />
    </div>
  );
}

/** Fetch each sibling env's key names; report keys missing from the current env. */
function useMissingKeys(project: string, env: string, siblings: string[], keys: KeyMeta[]) {
  const [missing, setMissing] = useState<{ env: string; keys: string[] }[]>([]);
  const have = useMemo(() => new Set(keys.map((k) => k.key)), [keys]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: { env: string; keys: string[] }[] = [];
      for (const sib of siblings) {
        try {
          const res = await api.get<{ keys: KeyMeta[] }>(
            `/api/projects/${project}/envs/${sib}/keys`,
          );
          const absent = res.keys.map((k) => k.key).filter((k) => !have.has(k));
          if (absent.length) out.push({ env: sib, keys: absent });
        } catch { /* ignore */ }
      }
      if (!cancelled) setMissing(out);
    })();
    return () => { cancelled = true; };
  }, [project, env, siblings.join(","), have]);
  return missing;
}

function KeyRow({
  meta, base, env, canWrite, canReveal, confirm, onChanged, onHistory,
}: {
  meta: KeyMeta; base: string; env: string;
  canWrite: boolean; canReveal: boolean;
  confirm: (label: string, cb: () => void) => void;
  onChanged: () => void;
  onHistory: () => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editDesc, setEditDesc] = useState(meta.description ?? "");
  const keyUrl = `${base}/keys/${encodeURIComponent(meta.key)}`;

  useEffect(() => {
    if (revealed === null) return;
    const t = setTimeout(() => setRevealed(null), 30_000);
    return () => clearTimeout(t);
  }, [revealed]);

  async function reveal() {
    if (revealed !== null) return setRevealed(null);
    try {
      const res = await api.get<{ value: string }>(keyUrl);
      setRevealed(res.value);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function copyValue() {
    try {
      const res = await api.get<{ value: string }>(keyUrl);
      await navigator.clipboard.writeText(res.value);
      toast.success("Copied");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const save = useMutation({
    mutationFn: () =>
      api.put(
        keyUrl,
        {
          value: editValue,
          ...(editDesc ? { description: editDesc } : {}),
          expectedVersion: meta.version,
        },
        { "x-confirm": env },
      ),
    onSuccess: () => {
      toast.success(`${meta.key} saved`);
      setEditing(false);
      onChanged();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
        toast.error("This key was changed by someone else — reload and try again");
      } else {
        toast.error(e.message);
      }
    },
  });

  const del = useMutation({
    mutationFn: () => api.del(keyUrl, { "x-confirm": env }),
    onSuccess: () => {
      toast.success(`${meta.key} deleted`);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  if (editing) {
    return (
      <TableRow>
        <TableCell className="font-mono text-xs">{meta.key}</TableCell>
        <TableCell colSpan={3}>
          <Textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="env-value min-h-16 text-xs"
            autoFocus
          />
          <Input
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            placeholder="Description (optional)"
            className="mt-1 text-xs"
          />
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button size="sm" onClick={() => confirm(`Save ${meta.key} in ${env}?`, () => save.mutate())} disabled={!editValue || save.isPending}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>
        <button
          className="font-mono text-xs hover:underline cursor-pointer"
          title="Click to copy"
          onClick={() => {
            void navigator.clipboard.writeText(meta.key);
            toast.success("Key copied");
          }}
        >
          {meta.key}
        </button>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <span className="env-value text-xs">
            {revealed !== null ? revealed : "••••••••"}
          </span>
          {canReveal && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={reveal} title={revealed ? "Hide" : "Reveal for 30s"}>
                <Eye />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyValue} title="Copy without revealing">
                <Copy />
              </Button>
            </>
          )}
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {relativeTime(meta.lastModified)}
        {meta.lastModifiedBy && (
          <span className="block max-w-40 truncate" title={meta.lastModifiedBy}>
            {meta.lastModifiedBy.split("/").pop()}
          </span>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">v{meta.version}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onHistory} title="History">
            <History />
          </Button>
          {canWrite && (
            <>
              <Button
                variant="ghost" size="icon" className="h-7 w-7" title="Edit"
                onClick={async () => {
                  try {
                    const res = await api.get<{ value: string }>(keyUrl);
                    setEditValue(res.value);
                    setEditing(true);
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost" size="icon" className="h-7 w-7" title="Delete"
                onClick={() => confirm(`Delete ${meta.key} from ${env}?`, () => del.mutate())}
              >
                <Trash2 className="text-destructive" />
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function AddRow({
  base, env, confirm, onDone, onCancel,
}: {
  base: string; env: string;
  confirm: (label: string, cb: () => void) => void;
  onDone: () => void; onCancel: () => void;
}) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [desc, setDesc] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api.put(
        `${base}/keys/${encodeURIComponent(key)}`,
        { value, ...(desc ? { description: desc } : {}) },
        { "x-confirm": env },
      ),
    onSuccess: () => {
      toast.success(`${key} added`);
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  const lowercaseWarn = key && key !== key.toUpperCase();

  return (
    <TableRow>
      <TableCell>
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="KEY_NAME"
          className="font-mono text-xs"
          autoFocus
        />
        {lowercaseWarn && (
          <p className="mt-1 text-xs text-amber-600">lowercase key — intentional?</p>
        )}
      </TableCell>
      <TableCell colSpan={3}>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="value"
          className="env-value min-h-16 text-xs"
        />
        <Input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Description (optional)"
          className="mt-1 text-xs"
        />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            disabled={!key || !value || save.isPending}
            onClick={() => confirm(`Add ${key} to ${env}?`, () => save.mutate())}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
