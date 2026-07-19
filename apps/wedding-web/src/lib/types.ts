// Shared client-safe DTO types (lib/api.ts is server-only and re-uses these).
export type Invite = { id: string; label: string; rsvp: 'yes' | 'no' | null };

export type EventSummary = {
  slug: string;
  name: string;
  sortOrder: number;
  data: Record<string, unknown>;
};

export type Wish = {
  id: string;
  name: string;
  text: string;
  color: string | null;
  createdAt: string;
};
