import { fetchPrintQueue } from '@/lib/print-queue-fetch';
import { PrintBoard } from '@/components/print-board';

/**
 * Print board (Hàng đợi in, P3-h). An async server component: fetch the live board once (cookie
 * forwarded to core-api), then hand it to the client board which keeps it live over SSE (+ poll
 * fallback) and mutates via the stage PATCH. Loading is ./loading.tsx (skeleton); a fetch failure is
 * caught by (app)/error.tsx (retry); an empty board is the client board's own zero-state (spec §03).
 */
export default async function PrintQueuePage() {
  const cards = await fetchPrintQueue();
  return <PrintBoard initialCards={cards} />;
}
