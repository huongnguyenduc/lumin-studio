// Stale gate: the committed src/schema.gen.ts MUST equal a fresh regen of the OpenAPI
// contract. This is the TS half of the codegen drift check (the Go half is the
// `make verify-go` oapi-codegen stale-check); together they stop the contract and its two
// generated clients from silently diverging. Because pnpm test must be green, a drift here
// fails the whole suite — the gate cannot no-op.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — codegen.mjs is a plain Node ESM script with no type declarations; importing
// its render fn is deliberate so this gate regenerates through the EXACT path `codegen` writes.
import { renderSchema, GEN_URL } from '../scripts/codegen.mjs';

describe('api-client contract codegen', () => {
  it('committed schema.gen.ts is a fresh regen of openapi.yaml (not stale)', async () => {
    const committed = readFileSync(fileURLToPath(GEN_URL as URL), 'utf8');
    const fresh: string = await renderSchema();
    expect(
      fresh,
      'schema.gen.ts is stale — run `pnpm --filter @lumin/api-client codegen` and commit the regen',
    ).toBe(committed);
  });
});
