import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface PreviewRow { key: string; status: "new" | "changed" | "unchanged" | "removed" }
interface Preview {
  rows: PreviewRow[];
  duplicates: string[];
  warnings: string[];
}

const STATUS_BADGE: Record<PreviewRow["status"], React.ReactNode> = {
  new: <Badge variant="success">new</Badge>,
  changed: <Badge variant="warning">changed</Badge>,
  unchanged: <Badge variant="secondary">unchanged</Badge>,
  removed: <Badge variant="destructive">removed</Badge>,
};

export function ImportDialog({
  project, env, isProtected, open, onOpenChange, initialText = "",
}: {
  project: string; env: string; isProtected: boolean;
  open: boolean; onOpenChange: (o: boolean) => void;
  initialText?: string;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText);
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/projects/${project}/envs/${env}`;

  async function runPreview() {
    setBusy(true);
    try {
      const res = await api.post<Preview>(`${base}/import/preview`, { text, replace });
      setPreview(res);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const res = await api.post<{ results: { key: string; ok: boolean; error?: string }[]; removed: string[] }>(
        `${base}/import`,
        { text, replace },
        isProtected ? { "x-confirm": env } : undefined,
      );
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length) {
        toast.warning(`${ok} keys written, ${failed.length} failed: ${failed.map((f) => f.key).join(", ")}`);
      } else {
        toast.success(`${ok} keys written${res.removed.length ? `, ${res.removed.length} removed` : ""}`);
      }
      await qc.invalidateQueries({ queryKey: ["keys", project, env] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
      setText("");
      setPreview(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import .env into {env}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setPreview(null); }}
            placeholder={"KEY=value\nOTHER=quoted \"value\""}
            className="h-40 font-mono text-xs"
          />
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              Choose .env file
            </Button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setText(await f.text());
              }}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); setPreview(null); }} />
              Replace whole environment (removes keys not in the file)
            </label>
          </div>

          {preview && (
            <div className="max-h-56 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Key</TableHead><TableHead>Status</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-mono text-xs">{r.key}</TableCell>
                      <TableCell>{STATUS_BADGE[r.status]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {preview && (preview.duplicates.length > 0 || preview.warnings.length > 0) && (
            <div className="text-xs text-amber-600">
              {preview.duplicates.length > 0 && <p>Duplicates (last wins): {preview.duplicates.join(", ")}</p>}
              {preview.warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!preview ? (
            <Button onClick={runPreview} disabled={!text.trim() || busy}>Preview</Button>
          ) : (
            <Button onClick={apply} disabled={busy}>Apply import</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
