// Route skeleton for the categories page (spec §03). Mirrors the header + list card. Decorative
// (aria-hidden); pulse stops under prefers-reduced-motion (motion-reduce + tokens.css backstop).
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-8 w-48 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
      <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-card p-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}
