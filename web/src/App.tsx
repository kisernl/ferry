import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useMe } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { EnvPage } from "@/pages/EnvPage";
import { SetupPage } from "@/pages/SetupPage";
import { GithubPage } from "@/pages/GithubPage";
import { UsersPage } from "@/pages/UsersPage";
import { AuditPage } from "@/pages/AuditPage";
import { DocsPage } from "@/pages/DocsPage";

export default function App() {
  const { data: me, isLoading } = useMe();
  const location = useLocation();
  const denied = new URLSearchParams(location.search).get("denied");

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">…</div>;
  }

  if (!me) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="w-full max-w-sm space-y-4 rounded-lg border p-8 text-center">
          <h1 className="text-2xl font-semibold">Ferry</h1>
          <p className="text-sm text-muted-foreground">
            Env vars on AWS Parameter Store, without the console.
          </p>
          {denied && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
              Your GitHub account is not authorized for this install.
            </p>
          )}
          <Button className="w-full" asChild>
            <a href="/api/auth/github">Sign in with GitHub</a>
          </Button>
        </div>
      </div>
    );
  }

  const isAdmin = me.role === "admin";

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="font-semibold">
            Ferry
          </Link>
          <nav className="flex items-center gap-3 text-sm text-muted-foreground">
            {isAdmin && (
              <>
                <Link to="/setup" className="hover:text-foreground">Setup</Link>
                <Link to="/settings/github" className="hover:text-foreground">GitHub</Link>
                <Link to="/admin/users" className="hover:text-foreground">Users</Link>
                <Link to="/admin/audit" className="hover:text-foreground">Audit log</Link>
              </>
            )}
            <Link to="/docs" className="hover:text-foreground">Docs</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{me.login}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await api.post("/api/auth/logout");
                window.location.href = "/";
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<ProjectsPage me={me} />} />
          <Route path="/setup" element={<SetupPage me={me} />} />
          <Route path="/p/:project/:env" element={<EnvPage me={me} />} />
          <Route path="/p/:project" element={<EnvRedirect />} />
          <Route path="/settings/github" element={<GithubPage me={me} />} />
          <Route path="/admin/users" element={<UsersPage me={me} />} />
          <Route path="/admin/audit" element={<AuditPage me={me} />} />
          <Route path="/docs" element={<DocsPage me={me} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function EnvRedirect() {
  const location = useLocation();
  const project = location.pathname.split("/")[2];
  return <Navigate to={`/p/${project}/development`} replace />;
}
