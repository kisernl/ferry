import type { Me } from "@/lib/api";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function K({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
}

export function DocsPage({ me }: { me: Me }) {
  void me;
  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">How Ferry works</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ferry is a web interface over AWS SSM Parameter Store. Secret values live in your AWS
          account, encrypted with KMS — they are never stored in this app's database, which only
          holds users, sessions, an audit log, and GitHub mappings.
        </p>
      </div>

      <Section title="Projects, environments, and keys">
        <p>
          Secrets are organized as <strong>project → environment → key</strong>. Each key becomes a
          parameter in SSM at <K>/ferry/&lt;project&gt;/&lt;env&gt;/&lt;KEY&gt;</K> — for example{" "}
          <K>/ferry/myapp/production/DATABASE_URL</K>.
        </p>
        <p>
          You can create projects here, or create parameters directly with the AWS CLI under the
          same path — <strong>Rescan AWS</strong> on the Projects page picks them up either way.
        </p>
      </Section>

      <Section title="Working with keys">
        <p>
          On an environment page you can add, edit, reveal, and delete keys. Reveals are fetched
          and decrypted on demand, auto-hide after 30 seconds, and are recorded in the audit log.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Import</strong> — paste or drop a <K>.env</K> file; you get a preview of new / changed / unchanged / removed keys before anything is written.</li>
          <li><strong>Download</strong> — exports the environment as a <K>.env</K> file that re-parses identically.</li>
          <li><strong>Copy</strong> — copy keys (and optionally values) to another environment. Keys-only copies arrive as an unsaved draft.</li>
          <li><strong>Diff</strong> — compare two environments; only statuses (added/changed/equal) are shown, not values.</li>
          <li><strong>History</strong> — every write creates a new SSM version; open a key's history to view or restore an older value (restore creates a new version, nothing is lost).</li>
        </ul>
      </Section>

      <Section title="Protected environments">
        <p>
          Environments marked <strong>protected</strong> (like <K>production</K>) require you to type
          the environment name before any write or delete — a speed bump, not a permission.
          Restricted editors can't write to them at all.
        </p>
      </Section>

      <Section title="Roles">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Viewer</strong> — sees keys and metadata, no reveals, downloads, or writes.</li>
          <li><strong>Editor</strong> — full key management, including reveals and exports.</li>
          <li><strong>Restricted editor</strong> — like editor, but blocked from protected environments. Set per-user on the Users page.</li>
          <li><strong>Admin</strong> — everything, plus users, audit log, and GitHub settings. Admins come from the <K>ADMIN_GITHUB_USERS</K> env var, not the UI.</li>
        </ul>
      </Section>

      <Section title="GitHub Actions">
        <p>
          The GitHub page generates IAM roles so CI workflows can read secrets directly from AWS via
          OIDC — no AWS keys stored in GitHub, and CI keeps working even if Ferry is down.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>All repos</strong> — one shared role per environment; every repo under the owner can use it. Simpler, less isolation.</li>
          <li><strong>Selected repos</strong> — one role per project+environment, usable only by repos you assign. More roles, tighter scoping.</li>
        </ul>
        <p>
          Copy the generated script and run it once with admin AWS credentials. The "Use these
          values" tab on each environment produces the workflow YAML. Jobs are pinned to a GitHub
          Environment (<K>environment: production</K>), so reviewers and branch rules on that
          environment still apply.
        </p>
      </Section>

      <Section title="Security notes">
        <ul className="list-disc space-y-1 pl-5">
          <li>Secret values exist only in memory during a request — never in the database, logs, or temp files.</li>
          <li>Every reveal, export, write, and sign-in is written to the audit log (admins can export CSV).</li>
          <li>AWS CloudTrail records every Parameter Store call independently — that is your second audit trail.</li>
          <li>Sessions expire after 12 hours (2 hours idle) and cookies are HttpOnly + Secure.</li>
        </ul>
      </Section>

      <Section title="Keyboard / CLI cheats">
        <p>
          Parameters created outside the app appear after <strong>Rescan AWS</strong>. Example CLI
          write that Ferry will pick up:
        </p>
        <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">
{`aws ssm put-parameter \\
  --name /ferry/myapp/staging/NEW_KEY \\
  --value 'secret' --type SecureString`}
        </pre>
      </Section>
    </div>
  );
}
