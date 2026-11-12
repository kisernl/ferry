import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface VersionRow { version: number; lastModified: string | null; lastModifiedBy: string | null }

export function HistorySheet({
  project, env, keyName, canEdit, open, onOpenChange,
}: {
  project: string; env: string; keyName: string; canEdit: boolean;
  open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const base = `/api/projects/${project}/envs/${env}/keys/${encodeURIComponent(keyName)}`;
  const { data } = useQuery({
    queryKey: ["history", project, env, keyName],
    queryFn: () => api.get<{ versions: VersionRow[] }>(`${base}/history`),
    enabled: open,
  });

  async function revealVersion(v: number) {
    try {
      const res = await api.get<{ value: string }>(`${base}/history/${v}`);
      setRevealed((r) => ({ ...r, [v]: res.value }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function restore(v: number) {
    try {
      await api.post(`${base}/restore`, { version: v }, { "x-confirm": env });
      toast.success(`Restored version ${v} as a new version`);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">{keyName}</SheetTitle>
          <SheetDescription>Version history (newest first)</SheetDescription>
        </SheetHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ver</TableHead><TableHead>Updated</TableHead><TableHead>Value</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.versions.map((v) => (
              <TableRow key={v.version}>
                <TableCell className="font-mono">v{v.version}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {relativeTime(v.lastModified)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {revealed[v.version] !== undefined ? (
                    <span className="env-value break-all">{revealed[v.version]}</span>
                  ) : canEdit ? (
                    <Button variant="ghost" size="sm" onClick={() => revealVersion(v.version)}>reveal</Button>
                  ) : (
                    "••••••"
                  )}
                </TableCell>
                <TableCell>
                  {canEdit && (
                    <Button variant="outline" size="sm" onClick={() => restore(v.version)}>Restore</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SheetContent>
    </Sheet>
  );
}
