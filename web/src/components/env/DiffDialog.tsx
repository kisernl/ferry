import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface DiffRow { key: string; status: "only_in_a" | "only_in_b" | "same" | "different" }

const STATUS: Record<DiffRow["status"], React.ReactNode> = {
  only_in_a: <Badge variant="warning">only in A</Badge>,
  only_in_b: <Badge variant="warning">only in B</Badge>,
  same: <Badge variant="secondary">same value</Badge>,
  different: <Badge variant="destructive">different value</Badge>,
};

export function DiffDialog({
  project, envs, currentEnv, open, onOpenChange,
}: {
  project: string; envs: string[]; currentEnv: string;
  open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const [a, setA] = useState(currentEnv);
  const [b, setB] = useState(envs.find((e) => e !== currentEnv) ?? envs[0]!);
  const { data, refetch, isFetching } = useQuery({
    queryKey: ["diff", project, a, b],
    queryFn: () =>
      api.get<{ rows: DiffRow[] }>(`/api/projects/${project}/diff?a=${a}&b=${b}`),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Diff environments</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Select value={a} onValueChange={setA}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {envs.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">vs</span>
          <Select value={b} onValueChange={setB}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {envs.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            Refresh
          </Button>
        </div>
        <div className="max-h-96 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Key</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data?.rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-mono text-xs">{r.key}</TableCell>
                  <TableCell>{STATUS[r.status]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
