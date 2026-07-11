// Zod schemas for the domain (spec §02). Server-authoritative: the create-order input has NO
// total/subtotal — the server computes them via money.calcTotals (conventions §Tiền).
//
// User-facing validation messages are i18n KEYS (catalog: i18n/vi.ts → `validation.*`), never inline
// Vietnamese literals — the UI resolves them via next-intl (conventions §i18n). Keep keys in sync.
import { z } from 'zod';

export const orderStatusEnum = z.enum([
  'PENDING_CONFIRM',
  'PAID',
  'PRINTING',
  'SHIPPING',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
]);
export type OrderStatusZ = z.infer<typeof orderStatusEnum>;

export const channelEnum = z.enum(['web', 'inbox']);
export const roleEnum = z.enum(['owner', 'staff', 'system']);

/** Money is always a non-negative integer of VND. */
export const intVnd = z.number().int().nonnegative();

/** Vietnamese address — NO district level (ADR-017): province → ward → street. */
export const AddressSchema = z.object({
  province: z.string().min(1),
  ward: z.string().min(1),
  street: z.string().min(1),
});

export const CustomerSchema = z.object({
  name: z.string().min(2).max(60),
  phone: z.string().regex(/^(0|\+84)\d{9}$/, 'validation.phoneInvalid'),
  email: z.string().email().optional(),
  socialHandle: z.string().optional(),
});

export const PersonalizationSchema = z.object({
  text: z.string().min(1),
  zoneId: z.string().min(1),
});

// ADR-037 configurator selections. A product with named parts picks one colour per part
// (partColors) instead of the flat colorId; a choice-option that offers choices is picked via
// optionChoices (text/toggle options stay in optionIds). Byte-identical to the OpenAPI
// PartColorSelection / OptionChoiceSelection and the Go internal/order snapshots.
export const PartColorSelectionSchema = z.object({
  partId: z.string().min(1),
  colorId: z.string().min(1),
});

export const OptionChoiceSelectionSchema = z.object({
  optionId: z.string().min(1),
  choiceId: z.string().min(1),
});

export const OrderItemSchema = z.object({
  productId: z.string().min(1),
  colorId: z.string().optional(),
  optionIds: z.array(z.string()).default([]),
  // Optional (absent = a flat product / no choices), matching the OpenAPI OrderItemInput — unlike
  // optionIds (always present, defaults to []), the configurator selections are additive: most lines omit them.
  partColors: z.array(PartColorSelectionSchema).optional(),
  optionChoices: z.array(OptionChoiceSelectionSchema).optional(),
  personalization: PersonalizationSchema.optional(),
  quantity: z.number().int().positive(),
  unitPrice: intVnd,
});

export const StatusEventSchema = z.object({
  from: orderStatusEnum.nullable(),
  to: orderStatusEnum,
  at: z.string().datetime(),
  byUser: z.string().min(1),
  reason: z.string().optional(),
  refundProofUrl: z.string().url().optional(),
});

export const OrderSchema = z.object({
  id: z.string(),
  code: z.string(),
  channel: channelEnum,
  status: orderStatusEnum,
  customer: CustomerSchema,
  shippingAddress: AddressSchema,
  items: z.array(OrderItemSchema).min(1),
  subtotal: intVnd,
  shippingFee: intVnd,
  total: intVnd,
  paymentProofUrl: z.string().url().optional(),
  paymentConfirmedAt: z.string().datetime().optional(),
  refundProofUrl: z.string().url().optional(),
  trackingCode: z.string().optional(),
  note: z.string().optional(),
  statusHistory: z.array(StatusEventSchema),
});

const hasPersonalization = (items: { personalization?: unknown }[]): boolean =>
  items.some((it) => it.personalization !== undefined);

/**
 * Web create-order input. NOTE: no total/subtotal (server computes). Personalized items require,
 * before payment (CHK-03 · ADR-012), BOTH: the "không đổi trả" acknowledgement and an explicit
 * echo confirmation of the engraving content.
 */
export const CreateWebOrderInput = z
  .object({
    channel: z.literal('web'),
    customer: CustomerSchema,
    shippingAddress: AddressSchema,
    items: z.array(OrderItemSchema).min(1),
    paymentProofUrl: z.string().url(),
    personalizationAck: z.boolean().optional(),
    engraveEchoConfirmed: z.boolean().optional(),
  })
  .refine((data) => !hasPersonalization(data.items) || data.personalizationAck === true, {
    message: 'validation.personalizationAckRequired',
    path: ['personalizationAck'],
  })
  .refine((data) => !hasPersonalization(data.items) || data.engraveEchoConfirmed === true, {
    message: 'validation.engraveEchoRequired',
    path: ['engraveEchoConfirmed'],
  });

export type Address = z.infer<typeof AddressSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type PartColorSelection = z.infer<typeof PartColorSelectionSchema>;
export type OptionChoiceSelection = z.infer<typeof OptionChoiceSelectionSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type CreateWebOrder = z.infer<typeof CreateWebOrderInput>;
