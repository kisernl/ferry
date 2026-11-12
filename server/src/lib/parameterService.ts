import {
  DeleteParameterCommand,
  DeleteParametersCommand,
  DescribeParametersCommand,
  GetParameterCommand,
  GetParameterHistoryCommand,
  GetParametersByPathCommand,
  PutParameterCommand,
  SSMClient,
  type ParameterMetadata,
} from "@aws-sdk/client-ssm";
import {
  envPath,
  keyFromParam,
  paramName,
  parseParamPath,
} from "@ferry/shared";
import { ApiError, badRequest, mapAwsError } from "./errors.js";

export interface KeyMeta {
  key: string;
  version: number;
  lastModified: string | null;
  lastModifiedBy: string | null;
  description: string | null;
}

export interface PutResult {
  version: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const name = (err as { name?: string })?.name ?? "";
      const retryable = /Throttl|TooManyUpdates|InternalServerError/.test(name);
      if (!retryable || i === attempts - 1) throw err;
      await sleep(2 ** i * 100 + Math.random() * 100);
    }
  }
  throw lastErr;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export class ParameterService {
  constructor(
    private ssm: SSMClient,
    private prefix: string,
    private kmsKeyId?: string,
  ) {}

  private path(project: string, env: string): string {
    return envPath(this.prefix, project, env);
  }

  private name(project: string, env: string, key: string): string {
    return paramName(this.prefix, project, env, key);
  }

  /** Metadata for all keys directly under an env path — never fetches values. */
  async listEnv(project: string, env: string): Promise<KeyMeta[]> {
    const metas: ParameterMetadata[] = [];
    let nextToken: string | undefined;
    do {
      const page = await withRetry(() =>
        this.ssm.send(
          new DescribeParametersCommand({
            ParameterFilters: [
              {
                Key: "Path",
                // Keys can't contain "/", so everything under an env path is
                // one level deep — Recursive is equivalent and works on LocalStack.
                Option: "Recursive",
                Values: [`${this.path(project, env)}/`],
              },
            ],
            MaxResults: 50,
            NextToken: nextToken,
          }),
        ),
      ).catch((e) => {
        throw mapAwsError(e);
      });
      metas.push(...(page.Parameters ?? []));
      nextToken = page.NextToken;
    } while (nextToken);

    return metas
      .filter((m) => m.Name)
      .map((m) => ({
        key: keyFromParam(m.Name!),
        version: m.Version ?? 0,
        lastModified: m.LastModifiedDate?.toISOString() ?? null,
        lastModifiedBy: m.LastModifiedUser ?? null,
        description: m.Description ?? null,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /** All parameter names under the prefix — used by Rescan. No values. */
  async scanPrefix(): Promise<{ project: string; env: string }[]> {
    const found = new Map<string, { project: string; env: string }>();
    let nextToken: string | undefined;
    do {
      const page = await withRetry(() =>
        this.ssm.send(
          new DescribeParametersCommand({
            ParameterFilters: [
              { Key: "Path", Option: "Recursive", Values: [`/${this.prefix}/`] },
            ],
            MaxResults: 50,
            NextToken: nextToken,
          }),
        ),
      ).catch((e) => {
        throw mapAwsError(e);
      });
      for (const p of page.Parameters ?? []) {
        if (!p.Name) continue;
        const parsed = parseParamPath(this.prefix, p.Name);
        if (parsed) {
          found.set(`${parsed.project}/${parsed.env}`, {
            project: parsed.project,
            env: parsed.env,
          });
        }
      }
      nextToken = page.NextToken;
    } while (nextToken);
    return [...found.values()];
  }

  /** Decrypted values for a whole env — used by export, diff, import preview. */
  async getAllValues(project: string, env: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    let nextToken: string | undefined;
    do {
      const page = await withRetry(() =>
        this.ssm.send(
          new GetParametersByPathCommand({
            Path: this.path(project, env),
            WithDecryption: true,
            MaxResults: 10,
            NextToken: nextToken,
          }),
        ),
      ).catch((e) => {
        throw mapAwsError(e);
      });
      for (const p of page.Parameters ?? []) {
        if (p.Name && p.Value !== undefined) {
          out.set(keyFromParam(p.Name), p.Value);
        }
      }
      nextToken = page.NextToken;
    } while (nextToken);
    return out;
  }

  async reveal(
    project: string,
    env: string,
    key: string,
  ): Promise<{ value: string; version: number }> {
    const res = await withRetry(() =>
      this.ssm.send(
        new GetParameterCommand({
          Name: this.name(project, env, key),
          WithDecryption: true,
        }),
      ),
    ).catch((e) => {
      throw mapAwsError(e);
    });
    return {
      value: res.Parameter?.Value ?? "",
      version: res.Parameter?.Version ?? 0,
    };
  }

  /** Current version without decryption — for expectedVersion checks. */
  async currentVersion(
    project: string,
    env: string,
    key: string,
  ): Promise<number | null> {
    try {
      const res = await withRetry(() =>
        this.ssm.send(
          new GetParameterCommand({
            Name: this.name(project, env, key),
            WithDecryption: false,
          }),
        ),
      );
      return res.Parameter?.Version ?? null;
    } catch (e) {
      if ((e as { name?: string })?.name === "ParameterNotFound") return null;
      throw mapAwsError(e);
    }
  }

  async put(
    project: string,
    env: string,
    key: string,
    value: string,
    opts: {
      description?: string;
      expectedVersion?: number;
      tags?: Record<string, string>;
    } = {},
  ): Promise<PutResult> {
    if (opts.expectedVersion !== undefined) {
      const current = await this.currentVersion(project, env, key);
      if (current !== opts.expectedVersion) {
        throw new ApiError(
          409,
          "VERSION_CONFLICT",
          `key was modified (now version ${current ?? "none"})`,
        );
      }
    }

    const exists = (await this.currentVersion(project, env, key)) !== null;
    const res = await withRetry(() =>
      this.ssm.send(
        new PutParameterCommand({
          Name: this.name(project, env, key),
          Value: value,
          Type: "SecureString",
          Tier: "Standard",
          // AWS rejects Tags combined with Overwrite: true — tag only on
          // first create (which uses Overwrite: false).
          Overwrite: exists,
          ...(this.kmsKeyId ? { KeyId: this.kmsKeyId } : {}),
          ...(opts.description !== undefined
            ? { Description: opts.description }
            : {}),
          ...(!exists && opts.tags
            ? {
                Tags: Object.entries(opts.tags).map(([Key, Value]) => ({
                  Key,
                  Value,
                })),
              }
            : {}),
        }),
      ),
    ).catch((e) => {
      throw mapAwsError(e);
    });
    return { version: res.Version ?? 0 };
  }

  /** Bulk put with limited concurrency; returns per-key outcomes. */
  async putMany(
    project: string,
    env: string,
    entries: { key: string; value: string; description?: string }[],
  ): Promise<{ key: string; ok: boolean; version?: number; error?: string }[]> {
    return mapLimit(entries, 3, async (e) => {
      try {
        const res = await this.put(project, env, e.key, e.value, {
          ...(e.description !== undefined
            ? { description: e.description }
            : {}),
          tags: {
            "managed-by": "ferry",
            "ferry-project": project,
            "ferry-env": env,
          },
        });
        return { key: e.key, ok: true, version: res.version };
      } catch (err) {
        return {
          key: e.key,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  }

  async delete(project: string, env: string, key: string): Promise<void> {
    await withRetry(() =>
      this.ssm.send(
        new DeleteParameterCommand({
          Name: this.name(project, env, key),
        }),
      ),
    ).catch((e) => {
      throw mapAwsError(e);
    });
  }

  async deleteMany(project: string, env: string, keys: string[]): Promise<void> {
    // DeleteParameters takes up to 10 names per call.
    for (let i = 0; i < keys.length; i += 10) {
      const names = keys
        .slice(i, i + 10)
        .map((k) => this.name(project, env, k));
      await withRetry(() =>
        this.ssm.send(new DeleteParametersCommand({ Names: names })),
      ).catch((e) => {
        throw mapAwsError(e);
      });
    }
  }

  /** Version metadata — never decrypts. */
  async history(project: string, env: string, key: string) {
    const res = await withRetry(() =>
      this.ssm.send(
        new GetParameterHistoryCommand({
          Name: this.name(project, env, key),
          WithDecryption: false,
          MaxResults: 50,
        }),
      ),
    ).catch((e) => {
      throw mapAwsError(e);
    });
    return (res.Parameters ?? [])
      .map((p) => ({
        version: p.Version ?? 0,
        lastModified: p.LastModifiedDate?.toISOString() ?? null,
        lastModifiedBy: p.LastModifiedUser ?? null,
      }))
      .sort((a, b) => b.version - a.version);
  }

  async revealVersion(
    project: string,
    env: string,
    key: string,
    version: number,
  ): Promise<string> {
    const res = await withRetry(() =>
      this.ssm.send(
        new GetParameterCommand({
          Name: `${this.name(project, env, key)}:${version}`,
          WithDecryption: true,
        }),
      ),
    ).catch((e) => {
      throw mapAwsError(e);
    });
    return res.Parameter?.Value ?? "";
  }


  /** All parameter names under an arbitrary path (recursive). No values. */
  async listNamesUnder(path: string): Promise<string[]> {
    const names: string[] = [];
    let nextToken: string | undefined;
    do {
      const page = await withRetry(() =>
        this.ssm.send(
          new DescribeParametersCommand({
            ParameterFilters: [
              { Key: "Path", Option: "Recursive", Values: [path] },
            ],
            MaxResults: 50,
            NextToken: nextToken,
          }),
        ),
      ).catch((e) => {
        throw mapAwsError(e);
      });
      for (const p of page.Parameters ?? []) if (p.Name) names.push(p.Name);
      nextToken = page.NextToken;
    } while (nextToken);
    return names;
  }

  /** Delete every parameter under an arbitrary path (recursive). */
  async deleteAllUnder(path: string): Promise<number> {
    const names = await this.listNamesUnder(path);
    for (let i = 0; i < names.length; i += 10) {
      const batch = names.slice(i, i + 10);
      await withRetry(() =>
        this.ssm.send(new DeleteParametersCommand({ Names: batch })),
      ).catch((e) => {
        throw mapAwsError(e);
      });
    }
    return names.length;
  }

  /** Full parameter name for a project path segment. */
  projectPath(project: string): string {
    return `/${this.prefix}/${project}/`;
  }

  /** Setup screen probes. On failure, `detail` is the AWS error name and
   *  `message` the full error (e.g. "not authorized to perform: ssm:PutParameter
   *  on resource: ..."), so the UI can point at the missing permission. */
  async probe(): Promise<
    { action: string; ok: boolean; detail: string; message?: string }[]
  > {
    const results: { action: string; ok: boolean; detail: string; message?: string }[] = [];
    const run = async (action: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        results.push({ action, ok: true, detail: "ok" });
      } catch (e) {
        results.push({
          action,
          ok: false,
          detail: (e as { name?: string })?.name ?? String(e),
          message: e instanceof Error ? e.message : undefined,
        });
      }
    };

    await run("ssm:DescribeParameters", () =>
      this.ssm.send(new DescribeParametersCommand({ MaxResults: 5 })),
    );
    await run("ssm:GetParametersByPath", () =>
      this.ssm.send(
        new GetParametersByPathCommand({
          Path: `/${this.prefix}/`,
          MaxResults: 1,
        }),
      ),
    );
    const probeName = `/${this.prefix}/__probe__/TEST`;
    await run("ssm:PutParameter", () =>
      this.ssm.send(
        new PutParameterCommand({
          Name: probeName,
          Value: "probe",
          Type: "SecureString",
          Overwrite: true,
        }),
      ),
    );
    await run("ssm:GetParameter", () =>
      this.ssm.send(
        new GetParameterCommand({ Name: probeName, WithDecryption: true }),
      ),
    );
    await run("ssm:DeleteParameter", () =>
      this.ssm.send(new DeleteParameterCommand({ Name: probeName })),
    );
    await run("ssm:GetParameterHistory", () =>
      this.ssm
        .send(new GetParameterHistoryCommand({ Name: probeName, MaxResults: 1 }))
        .catch((e) => {
          // history of a deleted param may 404 — that's fine, call worked
          if ((e as { name?: string })?.name === "ParameterNotFound") return {};
          throw e;
        }),
    );
    return results;
  }
}

export function ensureValidKeyOr400(key: string, isValid: (k: string) => boolean) {
  if (!isValid(key)) throw badRequest("KEY_INVALID", `invalid key: ${key}`);
}
