/** Fetch wrapper: sends the CSRF double-submit header on non-GET requests and
 *  unwraps the { error: { code, message } } shape. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)ferry-csrf=([^;]+)/);
  return m?.[1] ?? "";
}

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string>; raw?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  if (method !== "GET" && method !== "HEAD") {
    headers["x-csrf-token"] = csrfToken();
    if (opts.body !== undefined) headers["content-type"] = "application/json";
  }
  const res = await fetch(path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  if (opts.raw) return res as unknown as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(res.status, err?.code ?? "ERROR", err?.message ?? res.statusText);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>("POST", path, { body, headers }),
  put: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>("PUT", path, { body, headers }),
  patch: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>("PATCH", path, { body, headers }),
  del: <T>(path: string, headers?: Record<string, string>) =>
    request<T>("DELETE", path, { headers }),
  download: (path: string) =>
    request<Response>("GET", path, { raw: true }),
};

export interface Me {
  login: string;
  avatarUrl: string | null;
  role: "viewer" | "editor" | "admin";
  restricted: boolean;
}

export interface EnvInfo {
  name: string;
  protected: boolean;
  keyCount: number;
  lastModified: string | null;
}

export interface Project {
  name: string;
  createdAt: string;
  environments: EnvInfo[];
}

export interface KeyMeta {
  key: string;
  version: number;
  lastModified: string | null;
  lastModifiedBy: string | null;
  description: string | null;
}
