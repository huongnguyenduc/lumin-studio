// Route skeleton for the reviews page (spec §03). Mirrors the header + tab bar + a couple of review cards.
// Decorative (aria-hidden); pulse stops under prefers-reduced-motion (motion-reduce + tokens.css backstop).
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-8 w-40 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-10 w-28 animate-pulse rounded-t-lg bg-surface-sunken motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-lg border border-border-subtle bg-surface-card motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}
