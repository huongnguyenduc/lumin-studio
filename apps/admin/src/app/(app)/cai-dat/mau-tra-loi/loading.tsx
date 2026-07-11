// Route skeleton for the reply-templates page (spec §03). Mirrors the header + card grid. Decorative
// (aria-hidden); pulse stops under prefers-reduced-motion (motion-reduce + tokens.css backstop).
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-8 w-56 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-32 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
        <div className="h-32 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
      </div>
    </div>
  );
}
