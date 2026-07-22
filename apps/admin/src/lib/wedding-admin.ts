import 'server-only';

// Server-only bridge from the lumin admin to wedding-api (a separate service +
// `wedding` DB). Couple management lives here in the lumin admin; wedding-api
// grants master scope to any request carrying `Authorization: Bearer
// <WEDDING_MASTER_PASSWORD>` — the same value as wedding's ADMIN_PASSWORD,
// reused as a server-to-server token (no new secret). Both are server-only env,
// never in the client bundle. When unset (e.g. wedding-secrets not provisioned)
// the wedding page renders an "unavailable" state instead of throwing.

/** True when the bridge is configured (URL + master token both present). */
export function weddingConfigured(): boolean {
  return Boolean(process.env.WEDDING_API_URL && process.env.WEDDING_MASTER_PASSWORD);
}

export type WeddingApiResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'unavailable' } // bridge unconfigured or wedding-api unreachable
  | { status: 'error'; httpStatus: number; code: string };

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { code?: string } };
    return body.error?.code ?? `HTTP_${res.status}`;
  } catch {
    return `HTTP_${res.status}`;
  }
}

/**
 * Call a wedding-api /api/admin/* endpoint with the master bearer. `body`
 * undefined → no request body (GET/DELETE). Network failure or missing config
 * collapses to `unavailable`; a non-2xx collapses to `error` with the API's
 * error code so callers can branch (e.g. LAST_WEDDING, SUBDOMAIN_TAKEN).
 */
export async function weddingApi<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<WeddingApiResult<T>> {
  const base = process.env.WEDDING_API_URL;
  const token = process.env.WEDDING_MASTER_PASSWORD;
  if (!base || !token) return { status: 'unavailable' };

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    return { status: 'unavailable' };
  }

  if (!res.ok) {
    return { status: 'error', httpStatus: res.status, code: await parseError(res) };
  }
  if (res.status === 204) return { status: 'ok', data: undefined as T };
  return { status: 'ok', data: (await res.json()) as T };
}
