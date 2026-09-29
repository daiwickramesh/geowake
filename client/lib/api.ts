import { API_BASE } from "../config";

export class ApiError extends Error {
  readonly status: number;
  readonly errors: string[];

  constructor(message: string, status: number, errors: string[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }

  /** True when the session is no longer valid and the user must sign in. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

const firstMessage = (payload: unknown, fallback: string): string => {
  if (typeof payload !== "object" || payload === null) return fallback;
  const record = payload as { error?: unknown; errors?: unknown };
  if (typeof record.error === "string" && record.error.trim().length > 0) {
    return record.error;
  }
  if (Array.isArray(record.errors) && record.errors.length > 0) {
    return record.errors.filter((e): e is string => typeof e === "string").join(", ");
  }
  return fallback;
};

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

/**
 * Thin REST wrapper that always resolves to parsed JSON or throws an
 * {@link ApiError} with a message that is safe to show to the user.
 */
export const apiFetch = async <T = any>(
  path: string,
  { method = "GET", body, token, signal }: RequestOptions = {},
): Promise<T> => {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    // A `fetch` rejection is a *connection* failure, not a connectivity
    // problem on the user's machine: it is far more often that the API itself
    // is not running or is pointed at the wrong host. Name the actual cause.
    throw new ApiError(
      `Cannot reach the GeoWake API at ${API_BASE}. Make sure the server is running (cd server && npm run dev).`,
      0,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errors = Array.isArray((payload as { errors?: unknown })?.errors)
      ? ((payload as { errors: unknown[] }).errors).filter(
          (e): e is string => typeof e === "string",
        )
      : [];
    throw new ApiError(
      firstMessage(payload, `Request failed (${response.status}).`),
      response.status,
      errors,
    );
  }

  return payload as T;
};
