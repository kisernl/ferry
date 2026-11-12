import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  BookOpen, Folder, Github, LogOut, ScrollText, Settings2, Users,
} from "lucide-react";
import { useMe } from "@/lib/hooks";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
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
      <div className="flex h-screen items-center justify-center px-4">
        <div className="w-full max-w-md overflow-hidden rounded-xl border bg-card text-center shadow-sm">
          <img
            src="/ferry.png"
            alt="A ferry"
            className="ferry-bob mt-6 w-full select-none"
            draggable={false}
          />
          <div className="space-y-5 px-10 pb-10 pt-2">
            <h1 className="text-3xl font-semibold uppercase tracking-[0.22em]">Ferry</h1>
            <p className="text-sm text-muted-foreground">
              Your env vars, ferried safely to AWS Parameter Store.<br></br>
              No console required.
            </p>
            {denied && (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
                Your GitHub account isn't on the passenger list — ask an admin for access.
              </p>
            )}
            <Button className="w-full" asChild>
              <a href="/api/auth/github"><Github /> Sign in with GitHub</a>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = me.role === "admin";

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="px-6 pb-2 pt-7">
          <a
            href="https://github.com/kisernl/ferry"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5"
          >
            <img src="/ferry-icon.png" alt="" className="h-6 w-auto select-none" draggable={false} />
            <span className="text-xl font-semibold uppercase tracking-[0.22em]">Ferry</span>
          </a>
        </div>
        <nav className="flex-1 space-y-1 px-3 pt-4">
          <NavItem to="/" end icon={Folder}>Projects</NavItem>
          <NavItem to="/docs" icon={BookOpen}>Docs</NavItem>
          {isAdmin && (
            <>
              <p className="px-3 pb-1 pt-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Admin
              </p>
              <NavItem to="/setup" icon={Settings2}>Setup</NavItem>
              <NavItem to="/settings/github" icon={Github}>GitHub</NavItem>
              <NavItem to="/admin/users" icon={Users}>Users</NavItem>
              <NavItem to="/admin/audit" icon={ScrollText}>Audit log</NavItem>
            </>
          )}
        </nav>
        <div className="border-t p-3">
          <p className="truncate px-3 py-1.5 text-sm text-muted-foreground">{me.login}</p>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={async () => {
              await api.post("/api/auth/logout");
              window.location.href = "/";
            }}
          >
            <LogOut /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-2 overflow-x-auto border-b bg-card px-4 py-3 md:hidden">
          <a
            href="https://github.com/kisernl/ferry"
            target="_blank"
            rel="noopener noreferrer"
            className="mr-2 flex shrink-0 items-center gap-2 font-semibold tracking-tight"
          >
            <img src="/ferry-icon.png" alt="" className="h-6 w-auto select-none" draggable={false} />
            <span className="uppercase tracking-[0.22em]">Ferry</span>
          </a>
          <MobileNavLink to="/" end>Projects</MobileNavLink>
          <MobileNavLink to="/docs">Docs</MobileNavLink>
          {isAdmin && (
            <>
              <MobileNavLink to="/setup">Setup</MobileNavLink>
              <MobileNavLink to="/settings/github">GitHub</MobileNavLink>
              <MobileNavLink to="/admin/users">Users</MobileNavLink>
              <MobileNavLink to="/admin/audit">Audit log</MobileNavLink>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto shrink-0"
            onClick={async () => {
              await api.post("/api/auth/logout");
              window.location.href = "/";
            }}
          >
            Sign out
          </Button>
        </header>

        <main className="flex-1 px-6 py-10 sm:px-10 lg:px-14">
          <div className="mx-auto w-full max-w-5xl">
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
          </div>
        </main>
      </div>
    </div>
  );
}

function NavItem({ to, end, icon: Icon, children }: {
  to: string;
  end?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-accent font-medium text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )
      }
    >
      <Icon className="h-4 w-4" />
      {children}
    </NavLink>
  );
}

function MobileNavLink({ to, end, children }: {
  to: string;
  end?: boolean;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "shrink-0 rounded-md px-2.5 py-1.5 text-sm transition-colors",
          isActive
            ? "bg-accent font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )
      }
    >
      {children}
    </NavLink>
  );
}

function EnvRedirect() {
  const location = useLocation();
  const project = location.pathname.split("/")[2];
  return <Navigate to={`/p/${project}/development`} replace />;
}
