import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

interface Snippets {
  repo: string | null;
  roleName: string | null;
  reason: string | null;
  githubActions: string | null;
  awsCli: string;
  node: string;
  python: string;
  iamStatement: unknown;
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{code}</pre>
      <Button
        variant="outline"
        size="sm"
        className="absolute right-2 top-2"
        onClick={() => {
          void navigator.clipboard.writeText(code);
          toast.success("Copied");
        }}
      >
        Copy
      </Button>
    </div>
  );
}

export function SnippetsDialog({
  project, env, open, onOpenChange,
}: {
  project: string; env: string; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const [repo, setRepo] = useState("");
  const { data, refetch } = useQuery({
    queryKey: ["snippets", project, env, repo],
    queryFn: () =>
      api.get<Snippets>(
        `/api/projects/${project}/envs/${env}/snippets${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`,
      ),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Use these values — {env}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="gha">
          <TabsList>
            <TabsTrigger value="gha">GitHub Actions</TabsTrigger>
            <TabsTrigger value="cli">AWS CLI</TabsTrigger>
            <TabsTrigger value="sdk">Node / Python</TabsTrigger>
            <TabsTrigger value="iam">IAM</TabsTrigger>
          </TabsList>
          <TabsContent value="gha" className="space-y-3">
            <div className="space-y-1">
              <Label>Repo (owner/name)</Label>
              <div className="flex gap-2">
                <Input
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="acme/api"
                  className="font-mono"
                />
                <Button variant="outline" onClick={() => refetch()}>Apply</Button>
              </div>
            </div>
            {data?.githubActions ? (
              <CodeBlock code={data.githubActions} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {repo
                  ? data?.reason ?? "This repo has no access — connect it on the GitHub settings page."
                  : "Enter a repo to generate the workflow snippet."}
              </p>
            )}
          </TabsContent>
          <TabsContent value="cli">
            {data && <CodeBlock code={data.awsCli} />}
          </TabsContent>
          <TabsContent value="sdk" className="space-y-3">
            {data && (
              <>
                <CodeBlock code={data.node} />
                <CodeBlock code={data.python} />
              </>
            )}
          </TabsContent>
          <TabsContent value="iam">
            {data && <CodeBlock code={JSON.stringify(data.iamStatement, null, 2)} />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
