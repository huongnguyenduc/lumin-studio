/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** core-api origin the panel calls (ADR-043). Must match a manifest host_permissions entry. */
  readonly VITE_API_BASE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
