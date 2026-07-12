// Route skeleton for the customers list (P3-p, spec §03: loading is a skeleton, not a spinner). Mirrors
// the header + search + table shape. Decorative (aria-hidden); the pulse stops under prefers-reduced-motion
// (motion-reduce + tokens.css backstop).
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-8 w-64 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
      <div className="h-11 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
      <div className="h-72 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
    </div>
  );
}
