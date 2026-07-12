// Route skeleton for the staff & roles page (P3-q, spec §03). Mirrors the header + roster + matrix.
// Decorative (aria-hidden); pulse stops under prefers-reduced-motion (motion-reduce + tokens.css backstop).
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-8 w-64 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
      <div className="h-56 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
    </div>
  );
}
