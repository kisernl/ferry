/** Stable API error shape: { error: { code, message } } */

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function notFound(msg = "not found") {
  return new ApiError(404, "NOT_FOUND", msg);
}

export function forbidden(msg = "forbidden") {
  return new ApiError(403, "FORBIDDEN", msg);
}

export function badRequest(code: string, msg: string) {
  return new ApiError(400, code, msg);
}

const AWS_CODE_MAP: Record<string, { status: number; code: string }> = {
  AccessDeniedException: { status: 403, code: "AWS_ACCESS_DENIED" },
  AccessDenied: { status: 403, code: "AWS_ACCESS_DENIED" },
  ThrottlingException: { status: 429, code: "AWS_THROTTLED" },
  Throttling: { status: 429, code: "AWS_THROTTLED" },
  TooManyUpdatesException: { status: 429, code: "AWS_THROTTLED" },
  ParameterNotFound: { status: 404, code: "NOT_FOUND" },
  ParameterAlreadyExists: { status: 409, code: "ALREADY_EXISTS" },
  ParameterVersionNotFound: { status: 404, code: "NOT_FOUND" },
};

export function mapAwsError(err: unknown): ApiError {
  const name = (err as { name?: string })?.name ?? "";
  const mapped = AWS_CODE_MAP[name];
  if (mapped) {
    return new ApiError(mapped.status, mapped.code, `AWS error: ${name}`);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/4\s?KB|size/i.test(message)) {
    return new ApiError(400, "VALUE_TOO_LARGE", "value exceeds 4KB");
  }
  return new ApiError(502, "AWS_ERROR", `AWS call failed (${name || "unknown"})`);
}
