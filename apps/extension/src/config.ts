// core-api base URL — Vite injects VITE_-prefixed env at build. Set VITE_API_BASE_URL to the target
// origin (prod tunnel); defaults to the local dev core-api. Must match the manifest host_permissions
// (manifest.config.ts) so MV3 grants the cross-origin fetch (ADR-043).
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8090';
