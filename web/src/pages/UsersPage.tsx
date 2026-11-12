import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Me } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface UserRow {
  id: number;
  login: string;
  role: "viewer" | "editor";
  restricted: boolean;
  last_login_at: string | null;
}

export function UsersPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ users: UserRow[] }>("/api/users"),
    enabled: me.role === "admin",
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  if (me.role !== "admin") return <p>Admins only.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Admins are configured via <code>ADMIN_GITHUB_USERS</code> and are not listed as such here —
          this table toggles everyone else between viewer and editor.
        </p>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Login</TableHead><TableHead>Role</TableHead>
              <TableHead>Restricted</TableHead><TableHead>Last login</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {data?.users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-mono">{u.login}{u.login === me.login && " (you)"}</TableCell>
                <TableCell>
                  <Select
                    value={u.role}
                    onValueChange={async (v) => {
                      try {
                        await api.patch(`/api/users/${u.id}`, { role: v });
                        void refresh();
                      } catch (e) { toast.error((e as Error).message); }
                    }}
                  >
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">viewer</SelectItem>
                      <SelectItem value="editor">editor</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={u.restricted}
                      onChange={async (e) => {
                        try {
                          await api.patch(`/api/users/${u.id}`, { restricted: e.target.checked });
                          void refresh();
                        } catch (err) { toast.error((err as Error).message); }
                      }}
                    />
                    {u.restricted && <Badge variant="warning">no protected envs</Badge>}
                  </label>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {u.last_login_at ? new Date(u.last_login_at + "Z").toLocaleString() : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost" size="sm"
                    onClick={async () => {
                      try {
                        await api.post(`/api/users/${u.id}/revoke`, {});
                        toast.success(`Sessions revoked for ${u.login}`);
                      } catch (e) { toast.error((e as Error).message); }
                    }}
                  >
                    Revoke sessions
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
