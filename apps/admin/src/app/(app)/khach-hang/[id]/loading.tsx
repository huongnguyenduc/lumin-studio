// Route skeleton for the customer-detail page (P3-p, spec §03). Mirrors the header + two-column body
// (contact · order history). Decorative (aria-hidden); the pulse stops under prefers-reduced-motion.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-5 w-32 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
      <div className="h-10 w-56 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
      <div className="grid gap-6 md:grid-cols-[1fr_1.4fr]">
        <div className="h-64 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
        <div className="h-64 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
      </div>
    </div>
  );
}
