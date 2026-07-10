// Route skeleton for the order-detail page (spec §03: loading is a skeleton, not a spinner). Mirrors
// the real layout's shape (header · progress · two-column body) so the swap-in doesn't jump. Decorative
// only (aria-hidden); the pulse stops under prefers-reduced-motion (motion-reduce + tokens.css backstop).
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-8 w-48 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
      <div className="h-20 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <div className="h-72 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
        <div className="h-72 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
      </div>
    </div>
  );
}
