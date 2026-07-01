// @lumin/api-client — the typed HTTP client for core-api, generated from the OpenAPI
// contract (services/core-api/openapi.yaml, ADR-031). `createApiClient` wraps openapi-fetch
// with the generated `paths` type, so every request/response is checked against the contract
// at compile time — the TS mirror of the Go strict-server (oapi-codegen). Auth is a JWT in an
// httpOnly cookie (ADR-030), so credentials default to 'include'. Per-surface base-URL wiring
// (apps/admin dashboard) lands with 3j; this package is contract scaffolding only.
import createClient, { type Client, type ClientOptions } from 'openapi-fetch';
import type { paths } from './schema.gen';

export type ApiClient = Client<paths>;

/** Build a core-api client. Pass `{ baseUrl }` per surface; cookie credentials are on by default. */
export function createApiClient(options: ClientOptions = {}): ApiClient {
  return createClient<paths>({ credentials: 'include', ...options });
}

export type { components, operations, paths } from './schema.gen';
