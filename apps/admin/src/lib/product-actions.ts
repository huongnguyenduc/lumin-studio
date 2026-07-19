'use server';

import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server Actions for the product editor (P3-l l-1): create / update / delete the core product fields.
// Owner-only at the server (BE authOwnerOnly + assertOwner — a staff attempt collapses to `forbidden`;
// the raw VN envelope never leaks, ADR-032). Mirrors settings-actions/materials-actions, plus it surfaces
// the BE's per-field 400 (ErrorEnvelope.fields, e.g. a duplicate slug) so the editor can mark the field.

type ProductInput = components['schemas']['ProductInput'];
type ColorInput = components['schemas']['ColorInput'];
type PartInput = components['schemas']['PartInput'];
type OptionInput = components['schemas']['OptionInput'];
type OptionChoiceInput = components['schemas']['OptionChoiceInput'];
type Model3dView = components['schemas']['Model3dView'];

export type WriteCode = 'forbidden' | 'validation' | 'notFound' | 'inUse' | 'error';
/** Colours/parts/options persist per-row (P3-l l-3/l-4); the island refreshes from the server, so no body is needed. */
export type SubWriteResult = { ok: true } | { ok: false; code: WriteCode };
export type ProductWriteResult =
  | { ok: true; id: string }
  | { ok: false; code: WriteCode; fields?: Record<string, string> };

function codeFor(status: number): WriteCode {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'inUse'; // DELETE of a product referenced by an order/asset job → archive instead
  if (status === 400 || status === 422) return 'validation';
  return 'error';
}

async function authedClient() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });
}

export async function createProduct(input: ProductInput): Promise<ProductWriteResult> {
  try {
    const client = await authedClient();
    const { data, error, response } = await client.POST('/admin/products', { body: input });
    if (data) return { ok: true, id: data.id };
    return { ok: false, code: codeFor(response.status), fields: error?.fields };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function updateProduct(id: string, input: ProductInput): Promise<ProductWriteResult> {
  try {
    const client = await authedClient();
    const { data, error, response } = await client.PATCH('/admin/products/{id}', {
      params: { path: { id } },
      body: input,
    });
    if (data) return { ok: true, id: data.id };
    return { ok: false, code: codeFor(response.status), fields: error?.fields };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function deleteProduct(
  id: string,
): Promise<{ ok: true } | { ok: false; code: WriteCode }> {
  try {
    const client = await authedClient();
    const { error, response } = await client.DELETE('/admin/products/{id}', {
      params: { path: { id } },
    });
    if (!error) return { ok: true }; // 204 no body
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

// ── Colours & parts (P3-l l-3, ADR-037) — per-row CRUD sub-resources of a product. Owner-only at the
// server (BE authOwnerOnly). The editor island refreshes the RSC after each write, so success carries no
// body. Delete of a part (or colour) already pinned by an order → 409 → `inUse` (archive the product).

export async function createColor(productId: string, input: ColorInput): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.POST('/admin/products/{id}/colors', {
      params: { path: { id: productId } },
      body: input,
    });
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function updateColor(
  productId: string,
  colorId: string,
  input: ColorInput,
): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.PATCH('/admin/products/{id}/colors/{colorId}', {
      params: { path: { id: productId, colorId } },
      body: input,
    });
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function deleteColor(productId: string, colorId: string): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.DELETE('/admin/products/{id}/colors/{colorId}', {
      params: { path: { id: productId, colorId } },
    });
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function createPart(productId: string, input: PartInput): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.POST('/admin/products/{id}/parts', {
      params: { path: { id: productId } },
      body: input,
    });
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function updatePart(
  productId: string,
  partId: string,
  input: PartInput,
): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.PATCH('/admin/products/{id}/parts/{partId}', {
      params: { path: { id: productId, partId } },
      body: input,
    });
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function deletePart(productId: string, partId: string): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.DELETE('/admin/products/{id}/parts/{partId}', {
      params: { path: { id: productId, partId } },
    });
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

// ── Options & choices (P3-l l-4, ADR-037) — per-row CRUD sub-resources of a product. A `choice` option
// owns enumerated OptionChoice rows (nested under the option); a `text` option carries an engraving
// maxChars instead. Owner-only at the server; the island refreshes after each write. Delete of an option
// (or choice) already pinned by an order → 409 → `inUse` (archive the product).

export async function createOption(productId: string, input: OptionInput): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.POST('/admin/products/{id}/options', {
      params: { path: { id: productId } },
      body: input,
    });
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function updateOption(
  productId: string,
  optionId: string,
  input: OptionInput,
): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.PATCH('/admin/products/{id}/options/{optionId}', {
      params: { path: { id: productId, optionId } },
      body: input,
    });
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function deleteOption(productId: string, optionId: string): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.DELETE('/admin/products/{id}/options/{optionId}', {
      params: { path: { id: productId, optionId } },
    });
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function createChoice(
  productId: string,
  optionId: string,
  input: OptionChoiceInput,
): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.POST(
      '/admin/products/{id}/options/{optionId}/choices',
      { params: { path: { id: productId, optionId } }, body: input },
    );
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function updateChoice(
  productId: string,
  optionId: string,
  choiceId: string,
  input: OptionChoiceInput,
): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.PATCH(
      '/admin/products/{id}/options/{optionId}/choices/{choiceId}',
      { params: { path: { id: productId, optionId, choiceId } }, body: input },
    );
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export async function deleteChoice(
  productId: string,
  optionId: string,
  choiceId: string,
): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.DELETE(
      '/admin/products/{id}/options/{optionId}/choices/{choiceId}',
      { params: { path: { id: productId, optionId, choiceId } } },
    );
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

// Save the engrave anchor — the owner-picked surface point where the storefront projects a customer's
// engraving text onto the 3D model. Owner-only; 204 no body. Display metadata, not money.
export async function saveEngraveAnchor(
  productId: string,
  anchor: components['schemas']['EngraveAnchor'],
): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.PATCH('/admin/products/{id}/engrave-anchor', {
      params: { path: { id: productId } },
      body: anchor,
    });
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

// Save the default 3D camera pose (P3-l l-5, ADR-038). Owner-only; 204 no body. The pose is display
// metadata (degrees/percent/metres floats), not money — the storefront viewer opens at it.
export async function saveModelView(productId: string, view: Model3dView): Promise<SubWriteResult> {
  try {
    const client = await authedClient();
    const { error, response } = await client.PATCH('/admin/products/{id}/model-view', {
      params: { path: { id: productId } },
      body: view,
    });
    if (!error) return { ok: true };
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}
