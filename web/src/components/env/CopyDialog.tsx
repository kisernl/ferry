import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function CopyDialog({
  project, env, envs, isProtected, onKeysOnly,
  open, onOpenChange,
}: {
  project: string; env: string; envs: string[]; isProtected: boolean;
  onKeysOnly: (target: string, keys: string[]) => void;
  open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [to, setTo] = useState(envs.find((e) => e !== env) ?? "");
  const [includeValues, setIncludeValues] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await api.post<{ keys?: string[]; copied?: number }>(
        `/api/projects/${project}/envs/${env}/copy`,
        { to, includeValues },
        isProtected ? { "x-confirm": env } : undefined,
      );
      if (includeValues) {
        toast.success(`Copied ${res.copied} keys ${env} → ${to}`);
        await qc.invalidateQueries({ queryKey: ["projects"] });
      } else {
        onKeysOnly(to, res.keys ?? []);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy {env} → …</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Target environment</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {envs.filter((e) => e !== env).map((e) => (
                  <SelectItem key={e} value={e}>{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeValues} onChange={(e) => setIncludeValues(e.target.checked)} />
            Include values (unchecked = keys only, filled in later)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={run} disabled={!to || busy}>Copy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
