import { useState, useCallback } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Returns a `confirm(label, cb)` that runs cb immediately for unprotected
 *  envs, or opens a typed-confirmation dialog for protected ones. The cb
 *  receives the X-Confirm header value to send. */
export function useConfirmEnv(env: string, isProtected: boolean) {
  const [pending, setPending] = useState<{ label: string; cb: () => void } | null>(null);
  const [typed, setTyped] = useState("");

  const confirm = useCallback(
    (label: string, cb: () => void) => {
      if (!isProtected) return cb();
      setTyped("");
      setPending({ label, cb });
    },
    [isProtected],
  );

  const dialog = (
    <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pending?.label}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{env}</span> is a protected environment.
          Type the environment name to continue.
        </p>
        <div className="space-y-1">
          <Label>Environment name</Label>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={env}
            className="font-mono"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={typed !== env}
            onClick={() => {
              pending?.cb();
              setPending(null);
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, dialog };
}
