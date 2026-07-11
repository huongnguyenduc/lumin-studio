// Route skeleton for the settings page (spec §03: loading is a skeleton, not a spinner). Mirrors the
// header + two-column body so the swap-in doesn't jump. Decorative (aria-hidden); the pulse stops under
// prefers-reduced-motion (motion-reduce + tokens.css backstop).
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-8 w-48 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-6">
          <div className="h-48 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
          <div className="h-56 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
        </div>
        <div className="h-64 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
      </div>
    </div>
  );
}
