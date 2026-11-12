/** Naming rules shared by client and server. All path segments are validated
 *  before they reach the AWS SDK, so no path traversal into other prefixes. */

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/;
export const VALUE_MAX_BYTES = 4096; // Parameter Store Standard tier limit

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
}

export function isValidKey(s: string): boolean {
  return KEY_RE.test(s);
}

export function valueByteLength(v: string): number {
  return new TextEncoder().encode(v).length;
}

export function isValidValue(v: string): boolean {
  return v.length > 0 && valueByteLength(v) <= VALUE_MAX_BYTES;
}

/** Build the SSM path for an environment: /{prefix}/{project}/{env} */
export function envPath(prefix: string, project: string, env: string): string {
  return `/${prefix}/${project}/${env}`;
}

/** Build the full parameter name for a key. */
export function paramName(
  prefix: string,
  project: string,
  env: string,
  key: string,
): string {
  return `${envPath(prefix, project, env)}/${key}`;
}

/** Extract the key (last path segment) from a parameter name. */
export function keyFromParam(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

/** Parse /{prefix}/{project}/{env}/{KEY} → { project, env, key } or null. */
export function parseParamPath(
  prefix: string,
  name: string,
): { project: string; env: string; key: string } | null {
  const parts = name.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[0] !== prefix) return null;
  const [, project, env, key] = parts;
  if (!isValidSlug(project!) || !isValidSlug(env!) || !isValidKey(key!)) {
    return null;
  }
  return { project: project!, env: env!, key: key! };
}
