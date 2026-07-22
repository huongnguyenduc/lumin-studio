// Route skeleton for the weddings page (spec §03: loading is a skeleton, not a spinner).
// Decorative (aria-hidden); the pulse stops under prefers-reduced-motion.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-8 w-40 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
    </div>
  );
}
