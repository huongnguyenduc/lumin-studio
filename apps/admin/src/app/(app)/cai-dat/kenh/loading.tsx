// Route skeleton for the chat-channels page (P3-r, spec §03). Mirrors header + banner + two cards.
// Decorative (aria-hidden); pulse stops under prefers-reduced-motion (motion-reduce + tokens.css backstop).
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-8 w-56 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
      <div className="h-16 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="h-64 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
        <div className="h-64 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
      </div>
    </div>
  );
}
