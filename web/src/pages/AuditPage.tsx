import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Me } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface AuditRow {
  id: number; ts: string; user_login: string | null; ip: string | null;
  action: string; project: string | null; environment: string | null;
  key_name: string | null; detail: string | null;
}

export function AuditPage({ me }: { me: Me }) {
  const [filters, setFilters] = useState({ user: "", project: "", action: "" });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams();
  if (filters.user) qs.set("user", filters.user);
  if (filters.project) qs.set("project", filters.project);
  if (filters.action) qs.set("action", filters.action);
  qs.set("page", String(page));

  const { data } = useQuery({
    queryKey: ["audit", filters, page],
    queryFn: () => api.get<{ rows: AuditRow[]; total: number; pageSize: number }>(`/api/audit?${qs}`),
    enabled: me.role === "admin",
  });

  if (me.role !== "admin") return <p>Admins only.</p>;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Audit log</h1>
          <p className="text-sm text-muted-foreground">
            Every sign-in, reveal, export, and write is recorded here — never the secret values
            themselves. AWS CloudTrail is your independent second trail.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/audit?format=csv&${new URLSearchParams(Object.entries(filters).filter(([,v]) => v) as [string,string][])}`}>
            Export CSV
          </a>
        </Button>
      </div>
      <div className="flex gap-2">
        <Input placeholder="user" value={filters.user} onChange={(e) => { setFilters({ ...filters, user: e.target.value }); setPage(1); }} className="w-40" />
        <Input placeholder="project" value={filters.project} onChange={(e) => { setFilters({ ...filters, project: e.target.value }); setPage(1); }} className="w-40" />
        <Input placeholder="action" value={filters.action} onChange={(e) => { setFilters({ ...filters, action: e.target.value }); setPage(1); }} className="w-40" />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead><TableHead>User</TableHead><TableHead>Action</TableHead>
              <TableHead>Scope</TableHead><TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(r.ts + "Z").toLocaleString()}
                </TableCell>
                <TableCell className="text-sm">{r.user_login ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.action}</TableCell>
                <TableCell className="font-mono text-xs">
                  {[r.project, r.environment, r.key_name].filter(Boolean).join("/") || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.detail ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
        <span>Page {page} of {pages} ({data?.total ?? 0} rows)</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
      </div>
    </div>
  );
}
